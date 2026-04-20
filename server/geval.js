const OpenAI = require('openai');

async function gEval(summary, articleTitles) {
  if (!process.env.OPENAI_API_KEY) {
    return { relevance: null, coherence: null, grounding: null };
  }
  try {
    const openai     = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const titlesStr  = articleTitles.slice(0, 10).join('; ');

    const c = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content:
        `You are evaluating an AI-generated news summary.\n` +
        `Source article titles: ${titlesStr}\n` +
        `Summary: ${summary}\n\n` +
        `Rate on three dimensions from 1.0 to 5.0.\n` +
        `Return ONLY valid JSON, no markdown fences:\n` +
        `{"relevance": X.X, "coherence": X.X, "grounding": X.X}`
      }],
      max_tokens: 50,
      temperature: 0,
    });

    const raw = c.choices[0].message.content
      .trim()
      .replace(/```(?:json)?/g, '')
      .replace(/```/g, '')
      .trim();

    const scores = JSON.parse(raw);
    return {
      relevance: typeof scores.relevance === 'number' ? +scores.relevance.toFixed(2) : null,
      coherence: typeof scores.coherence === 'number' ? +scores.coherence.toFixed(2) : null,
      grounding: typeof scores.grounding === 'number' ? +scores.grounding.toFixed(2) : null,
    };
  } catch (e) {
    console.warn('[G-Eval] failed:', e.message);
    return { relevance: null, coherence: null, grounding: null };
  }
}

module.exports = { gEval };
