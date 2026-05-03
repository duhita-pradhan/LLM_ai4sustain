const OpenAI = require('openai');

const CATEGORIES = ['renewable', 'emissions', 'biodiversity', 'water', 'policy'];

const KEYWORD_LISTS = {
  renewable:    ['solar', 'wind', 'renewable', 'geothermal', 'hydrogen', 'turbine', 'photovoltaic', 'battery', 'ev', 'electric vehicle'],
  emissions:    ['carbon', 'emission', 'methane', 'co2', 'greenhouse', 'fossil', 'net zero', 'decarbonize', 'coal'],
  biodiversity: ['species', 'forest', 'wildlife', 'ecosystem', 'biodiversity', 'deforestation', 'coral', 'reef', 'extinction'],
  water:        ['ocean', 'water', 'flood', 'drought', 'river', 'sea level', 'groundwater', 'glacier', 'aquifer'],
  policy:       ['policy', 'agreement', 'cop', 'law', 'regulation', 'government', 'treaty', 'pledge', 'summit', 'legislation'],
};

function classifyKeyword(title, snippet) {
  const text = ((title || '') + ' ' + (snippet || '')).toLowerCase();
  let best = null, bestScore = 0;
  for (const cat of CATEGORIES) {
    const score = KEYWORD_LISTS[cat].filter(w => text.includes(w)).length;
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  return best || 'renewable';
}

function keywordClassifyAll(articles) {
  return articles.map(a => classifyKeyword(a.title, a.snippet));
}

async function gptClassifyBatch(articles, openai) {
  const c = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content:
      `Classify EXACTLY ${articles.length} articles.\n` +
      `Return EXACTLY ${articles.length} strings in a JSON array.\n` +
      `Categories: renewable, emissions, biodiversity, water, policy\n\n` +
      articles.map((a, i) => `[${i}] ${a.title}`).join('\n') +
      `\n\nReturn only the JSON array, example: ["renewable","policy","water"]`
    }],
    max_tokens: 300,
    temperature: 0,
  });

  const raw = c.choices[0].message.content.trim();
  const clean = raw.replace(/```(?:json)?/g, '').replace(/```/g, '').trim();

  let preds;
  try {
    preds = JSON.parse(clean);
  } catch (e) {
    console.warn('[Classifier] JSON parse failed, using keyword fallback');
    return articles.map(a => classifyKeyword(a.title, a.snippet));
  }

  if (!Array.isArray(preds)) {
    return articles.map(a => classifyKeyword(a.title, a.snippet));
  }

  const result = [];
  for (let i = 0; i < articles.length; i++) {
    const p = preds[i];
    result.push(CATEGORIES.includes(p) ? p : classifyKeyword(articles[i].title, articles[i].snippet));
  }
  return result;
}

async function gptClassifyAll(articles) {
  if (!process.env.OPENAI_API_KEY) return null;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const BATCH  = 20;
  const all    = [];

  for (let i = 0; i < articles.length; i += BATCH) {
    const batch = articles.slice(i, i + BATCH);
    try {
      const preds = await gptClassifyBatch(batch, openai);
      all.push(...preds);
    } catch (e) {
      console.warn(`[Classifier] GPT batch ${i}–${i + BATCH} failed:`, e.message);
      all.push(...batch.map(a => classifyKeyword(a.title, a.snippet)));
    }
    if (i + BATCH < articles.length) await new Promise(r => setTimeout(r, 500));
  }
  return all;
}

function computeMetrics(gold, pred) {
  const total    = gold.length;
  const correct  = gold.filter((g, i) => g === pred[i]).length;
  const perClass = {};

  for (const cat of CATEGORIES) {
    let tp = 0, fp = 0, fn = 0;
    for (let i = 0; i < total; i++) {
      const g = gold[i] === cat, p = pred[i] === cat;
      if (g && p) tp++;
      else if (!g && p) fp++;
      else if (g && !p) fn++;
    }
    const pr = tp + fp > 0 ? tp / (tp + fp) : 0;
    const re = tp + fn > 0 ? tp / (tp + fn) : 0;
    perClass[cat] = {
      precision: +pr.toFixed(3),
      recall:    +re.toFixed(3),
      f1:        pr + re > 0 ? +(2 * pr * re / (pr + re)).toFixed(3) : 0,
      support:   gold.filter(g => g === cat).length,
    };
  }

  const macroF1 = +(
    CATEGORIES.reduce((s, c) => s + perClass[c].f1, 0) / CATEGORIES.length
  ).toFixed(3);

  return {
    accuracy: +(correct / total).toFixed(3),
    macroF1,
    perClass,
  };
}

module.exports = { classifyKeyword, keywordClassifyAll, gptClassifyAll, computeMetrics, CATEGORIES };
