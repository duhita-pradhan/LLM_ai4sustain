require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const OpenAI    = require('openai');

const { getArticles }    = require('./gdelt');
const { classifyKeyword } = require('./classifier');
const { gEval }          = require('./geval');
const { runOnce }        = require('./eval_runner');

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

  // 2. Build chart data
  const chartData = buildChartData(articles, timeWindow);

  // 3. GPT summary
  let summary      = '';
  let sentimentArr = chartData.labels.map(() => 3.0);

  if (process.env.OPENAI_API_KEY && articles.length > 0) {
    try {
      const openai  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const snippet = articles.slice(0, 15).map((a, i) =>
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

  // 4. Live keyword precision
  const kwPreds       = articles.map(a => classifyKeyword(a.title, a.snippet));
  const keywordPrec   = articles.length > 0
    ? +(kwPreds.filter(p => p === theme).length / articles.length).toFixed(3)
    : 0;

  const evalReady = fs.existsSync(EVAL_PATH);

  // Annotate articles with category
  const articlesOut = articles.map((a, i) => ({ ...a, category: kwPreds[i] }));

  res.json({
    articles:         articlesOut,
    summary,
    chartData:        { labels: chartData.labels, values: chartData.values, sentiment: sentimentArr },
    keywordPrecision: keywordPrec,
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
