require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs   = require('fs');
const path = require('path');

const { keywordClassifyAll, gptClassifyAll, computeMetrics } = require('./classifier');
const { classifyWithDeBERTa }                                = require('./deberta');
const { gEval }                                              = require('./geval');

const DATA_DIR   = path.join(__dirname, '..', 'data');
const EVAL_PATH  = path.join(DATA_DIR, 'eval_results.json');
const LABEL_PATH = path.join(DATA_DIR, 'labeled_articles.json');

async function runEvaluation() {
  let labeled;
  try {
    labeled = JSON.parse(fs.readFileSync(LABEL_PATH, 'utf8'));
  } catch (e) {
    console.warn('[Eval] Cannot read labeled_articles.json:', e.message);
    return;
  }

  console.log(`[Eval] Starting evaluation on ${labeled.length} articles…`);
  const gold = labeled.map(a => a.label);

  // ── 1. Keyword baseline ──────────────────────────────────────────────────
  const kwPreds   = keywordClassifyAll(labeled);
  const kwMetrics = computeMetrics(gold, kwPreds);
  console.log(`[Eval] Keyword done.    Macro F1: ${kwMetrics.macroF1}`);

  // ── 2. GPT zero-shot ─────────────────────────────────────────────────────
  let gptMetrics = null;
  if (process.env.OPENAI_API_KEY) {
    const gptPreds = await gptClassifyAll(labeled);
    if (gptPreds) {
      gptMetrics = computeMetrics(gold, gptPreds);
      console.log(`[Eval] GPT zero-shot done. Macro F1: ${gptMetrics.macroF1}`);
    } else {
      console.warn('[Eval] GPT zero-shot returned null');
    }
  } else {
    console.warn('[Eval] GPT zero-shot skipped — no OPENAI_API_KEY');
  }

  // ── 3. DeBERTa ───────────────────────────────────────────────────────────
  let debertaMetrics = null;
  console.log('[DeBERTa] Starting classification...');
  const debertaPreds = await classifyWithDeBERTa(labeled);
  console.log('[DeBERTa] Result:', debertaPreds === null ? 'returned null' : `${debertaPreds.length} predictions`);
  if (debertaPreds && debertaPreds.length === labeled.length) {
    const DEBERTA_LABEL_MAP = {
      'renewable energy': 'renewable',
      'carbon emissions': 'emissions',
      'biodiversity':     'biodiversity',
      'water resources':  'water',
      'climate policy':   'policy',
    };
    const mappedPreds = debertaPreds.map(p => {
      const raw = (p.label || p || '').toLowerCase();
      return DEBERTA_LABEL_MAP[raw] || raw;
    });
    debertaMetrics = computeMetrics(gold, mappedPreds);
    console.log(`[Eval] DeBERTa done. Macro F1: ${debertaMetrics.macroF1}`);
  }

  // ── 4. G-Eval on 5-article sample ────────────────────────────────────────
  let gevalScores = { relevance: null, coherence: null, grounding: null };
  if (process.env.OPENAI_API_KEY) {
    try {
      const OpenAI = require('openai');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const sample = labeled.slice(0, 5)
        .map((a, i) => `${i + 1}. ${a.title} — ${(a.snippet || '').substring(0, 80)}`)
        .join('\n');
      const sumR = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content:
          `Summarize these sustainability news articles in 3–4 sentences:\n${sample}`
        }],
        max_tokens: 200, temperature: 0.3,
      });
      const sampleSummary = sumR.choices[0].message.content.trim();
      gevalScores = await gEval(sampleSummary, labeled.slice(0, 5).map(a => a.title));
      console.log(`[Eval] G-Eval done. Coherence: ${gevalScores.coherence}`);
    } catch (e) {
      console.warn('[Eval] G-Eval failed:', e.message);
    }
  }

  // ── Write results ────────────────────────────────────────────────────────
  const result = {
    total:     labeled.length,
    timestamp: new Date().toISOString(),
    keyword:   kwMetrics,
    gpt:       gptMetrics,
    deberta:   debertaMetrics,
    geval:     gevalScores,
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(EVAL_PATH, JSON.stringify(result, null, 2));
  console.log('[Eval] Results written to data/eval_results.json');
  return result;
}

let _ran = false;

async function runOnce() {
  if (_ran) return;
  _ran = true;

  if (fs.existsSync(EVAL_PATH)) {
    console.log('[Eval] eval_results.json exists — skipping auto-eval');
    return;
  }

  if (!fs.existsSync(LABEL_PATH)) {
    console.log('[Eval] labeled_articles.json not found — skipping auto-eval');
    return;
  }

  console.log('[Eval] Launching background evaluation…');
  // Fire-and-forget — never blocks server startup
  runEvaluation().catch(e => console.warn('[Eval] background eval failed:', e.message));
}

module.exports = { runOnce, runEvaluation };
