# AI4Sustain — Environmental Insight & Trend Analysis

LLM Course Final Project · TeamX · Spring 2026

## Setup

```bash
# 1. Install Node dependencies
npm install

# 2. Install Python ML dependencies
pip install -r ml/requirements.txt

# 3. Configure environment variables
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

# 4. Start the server
node server/server.js
```

The first run will:
- Download the DeBERTa model (~500 MB, one time only, saved to ml/model_cache/)
- Run full evaluation on data/labeled_articles.json (~3 minutes)
- Start serving on http://localhost:3000

## Project Structure

```
ai4sustain/
├── server/
│   ├── server.js        Express backend, routes, chart builder
│   ├── gdelt.js         GDELT v2 article fetcher with fallbacks
│   ├── classifier.js    Keyword baseline + GPT zero-shot classifier
│   ├── deberta.js       DeBERTa inference via Python subprocess
│   ├── geval.js         G-Eval LLM-as-judge scoring
│   └── eval_runner.js   Auto-runs full evaluation on startup
├── ml/
│   ├── deberta_infer.py HuggingFace zero-shot pipeline script
│   ├── requirements.txt Python dependencies
│   └── model_cache/     DeBERTa model downloaded here automatically
├── data/
│   ├── labeled_articles.json  Hand-labeled test set
│   └── eval_results.json      Auto-generated evaluation results
├── public/
│   └── index.html       Full single-page frontend
├── .env.example
└── package.json
```

## Evaluation

Three classifiers are compared automatically on startup:

| Classifier      | Approach                                              |
|-----------------|-------------------------------------------------------|
| Keyword Baseline | Keyword count matching per category                  |
| GPT Zero-shot   | GPT-4o-mini single-prompt batch classification        |
| DeBERTa-v3      | cross-encoder/nli-deberta-v3-small zero-shot NLI     |

Results are written to `data/eval_results.json` and displayed live in the UI.

G-Eval (LLM-as-judge) scores RAG summaries on relevance, coherence, and grounding after each analysis run.

## Requirements

- Node.js ≥ 18
- Python ≥ 3.9 (for DeBERTa; site works without it)
- OPENAI_API_KEY (for GPT summary + G-Eval; GDELT fetch works without it)
