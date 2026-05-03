require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const OpenAI    = require('openai');

const { getArticles }         = require('./gdelt');
const { classifyKeyword }     = require('./classifier');
const { classifyWithDeBERTa } = require('./deberta');
const { gEval }               = require('./geval');
const { runOnce }             = require('./eval_runner');

const MUST_HAVE_KEYWORDS = {
  renewable:    ['solar', 'wind', 'renewable', 'energy', 'hydrogen', 'battery', 'electric', 'geothermal', 'turbine', 'clean power'],
  emissions:    ['carbon', 'emission', 'climate', 'methane', 'fossil', 'coal', 'greenhouse', 'co2', 'net zero'],
  biodiversity: ['species', 'forest', 'wildlife', 'biodiversity', 'coral', 'reef', 'extinction', 'habitat', 'conservation', 'ecosystem'],
  water:        ['water', 'flood', 'drought', 'ocean', 'river', 'sea level', 'glacier', 'aquifer', 'rainfall'],
  policy:       ['climate policy', 'cop', 'carbon tax', 'paris agreement', 'net zero', 'regulation', 'environmental law'],
};

const app       = express();
const DATA_DIR  = path.join(__dirname, '..', 'data');
const EVAL_PATH = path.join(DATA_DIR, 'eval_results.json');
const PUB_DIR   = path.join(__dirname, '..', 'public');

app.use(express.json());
app.use(express.static(PUB_DIR));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/eval — return eval_results.json or {status:"computing"}
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/eval', (req, res) => {
  try {
    res.json(JSON.parse(fs.readFileSync(EVAL_PATH, 'utf8')));
  } catch {
    res.json({ status: 'computing' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/analyze
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  const { theme = 'renewable', region = 'global', timeWindow = '30d' } = req.body;

  // 1. Fetch articles from GDELT
  const articles = await getArticles(theme, region, timeWindow);

  // 2. DeBERTa re-ranker — filter to on-theme articles before summary
  let filteredArticles = articles;
  const debertaResults = await classifyWithDeBERTa(articles).catch(() => null);

  let debertaKept = null;
  if (debertaResults && debertaResults.length === articles.length) {
    // Pass if: (DeBERTa label matches theme AND score >= 0.5) OR title has a must-have keyword
    const mustHave = MUST_HAVE_KEYWORDS[theme] || [];
    const onTheme  = articles.filter((a, i) => {
      const { label, score } = debertaResults[i];
      const titleText     = (a.title || '').toLowerCase();
      const debertaPass   = label === theme && score >= 0.55;
      const keywordPass   = mustHave.some(kw => titleText.includes(kw));
      return debertaPass || keywordPass;
    });
    filteredArticles = onTheme.length >= 3 ? onTheme : articles;
    const avgConf = debertaResults
      .filter((_, i) => filteredArticles.includes(articles[i]))
      .reduce((s, r) => s + r.score, 0) / (filteredArticles.length || 1);
    debertaKept = {
      kept:    filteredArticles.length,
      total:   articles.length,
      avgConf: +avgConf.toFixed(3),
    };
    console.log(`[DeBERTa] re-rank: ${articles.length} → ${filteredArticles.length} articles (theme="${theme}", avgConf=${debertaKept.avgConf})`);
  } else {
    console.log('[DeBERTa] re-rank skipped (unavailable), using all articles');
  }

  // 3. Build chart data from filtered set
  const chartData = buildChartData(filteredArticles, timeWindow);

  // 4. GPT summary over filtered articles
  let summary      = '';
  let sentimentArr = chartData.labels.map(() => 3.0);

  if (process.env.OPENAI_API_KEY && filteredArticles.length > 0) {
    try {
      const openai  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const snippet = filteredArticles.slice(0, 15).map((a, i) =>
        `${i + 1}. "${a.title}"${a.snippet ? ' — ' + a.snippet.substring(0, 100) : ''} [${a.source}]`
      ).join('\n');

      const c = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content:
          `Environmental news analyst. Summarize trends in "${theme}" articles.\n\n` +
          `Articles:\n${snippet}\n\n` +
          `Return ONLY valid JSON (no markdown):\n` +
          `{"summary":"3-4 sentence RAG trend summary","sentiment":[${chartData.labels.length} floats 1.0-5.0]}`
        }],
        max_tokens: 500, temperature: 0.3,
      });

      const p = JSON.parse(c.choices[0].message.content.trim());
      summary = p.summary || '';
      if (Array.isArray(p.sentiment) && p.sentiment.length > 0) {
        sentimentArr = p.sentiment.slice(0, chartData.labels.length).map(Number);
        while (sentimentArr.length < chartData.labels.length) sentimentArr.push(3.0);
      }
    } catch (e) {
      console.warn('[OpenAI] summary failed:', e.message);
    }
  }

  // 5. Live keyword precision on filtered set
  const kwPreds     = filteredArticles.map(a => classifyKeyword(a.title, a.snippet));
  const keywordPrec = filteredArticles.length > 0
    ? +(kwPreds.filter(p => p === theme).length / filteredArticles.length).toFixed(3)
    : 0;

  const evalReady = fs.existsSync(EVAL_PATH);

  // Annotate each article with keyword category, DeBERTa label, and confidence
  const articlesOut = filteredArticles.map((a, i) => {
    const origIdx = articles.indexOf(a);
    const dr      = debertaResults && origIdx !== -1 ? debertaResults[origIdx] : null;
    return {
      ...a,
      category:     kwPreds[i],
      debertaLabel: dr ? dr.label : null,
      confidence:   dr ? dr.score : null,
    };
  });

  res.json({
    articles:         articlesOut,
    summary,
    chartData:        { labels: chartData.labels, values: chartData.values, sentiment: sentimentArr },
    keywordPrecision: keywordPrec,
    debertaKept,
    evalReady,
  });

  // 5. Background G-Eval — fire-and-forget, writes to eval_results.json
  if (summary && process.env.OPENAI_API_KEY) {
    gEval(summary, articles.slice(0, 10).map(a => a.title))
      .then(scores => {
        if (!scores.coherence) return;
        let existing = {};
        try { existing = JSON.parse(fs.readFileSync(EVAL_PATH, 'utf8')); } catch {}
        fs.writeFileSync(EVAL_PATH, JSON.stringify({
          ...existing,
          geval: scores,
          lastUpdated: new Date().toISOString(),
        }, null, 2));
        console.log(`[G-Eval] written — coherence=${scores.coherence}`);
      })
      .catch(() => {});
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const WINDOW_DAYS = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function buildChartData(articles, timeWindow) {
  const days     = WINDOW_DAYS[timeWindow] || 30;
  const buckets  = days <= 7 ? 7 : 6;
  const now      = Date.now();
  const start    = now - days * 86400000;
  const bucketMs = (days * 86400000) / buckets;

  const labels = Array.from({ length: buckets }, (_, i) => {
    const t = new Date(start + (i + 0.5) * bucketMs);
    return days <= 7
      ? DAYS[t.getDay()]
      : days <= 90
        ? MONTHS[t.getMonth()] + ' ' + t.getDate()
        : MONTHS[t.getMonth()];
  });

  const counts = new Array(buckets).fill(0);
  articles.forEach(a => {
    if (!a.date || a.date.length < 8) return;
    const t = new Date(
      +a.date.substring(0, 4),
      +a.date.substring(4, 6) - 1,
      +a.date.substring(6, 8)
    ).getTime();
    const i = Math.floor((t - start) / bucketMs);
    if (i >= 0 && i < buckets) counts[i]++;
  });

  return { labels, values: counts };
}

// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI4Sustain → http://localhost:${PORT}`);
  // Kick off background evaluation if eval_results.json doesn't exist yet
  runOnce();
});
