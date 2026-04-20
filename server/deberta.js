// DeBERTa is disabled for Node-only deployment (Render).
// Returns null immediately so the frontend hides the DeBERTa bar gracefully.
async function classifyWithDeBERTa(_articles) {
  return null;
}

module.exports = { classifyWithDeBERTa };
