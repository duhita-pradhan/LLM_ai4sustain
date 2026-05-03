const { spawn } = require('child_process');
const path = require('path');

const LABEL_MAP = {
  'renewable energy': 'renewable',
  'carbon emissions': 'emissions',
  'biodiversity':     'biodiversity',
  'water resources':  'water',
  'climate policy':   'policy',
};

const LABELS = Object.keys(LABEL_MAP);

// On Windows 'python' is the correct command; on Linux/Mac use 'python3'
const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

// Returns an array of { label, score } objects, or null on failure.
// label is mapped to our short key (renewable, emissions, etc.)
// score is the model's confidence 0.0–1.0
async function classifyWithDeBERTa(articles) {
  const texts      = articles.map(a =>
    ((a.title || '') + ' ' + (a.snippet || '')).trim().substring(0, 256)
  );
  const scriptPath = path.join(__dirname, '..', 'ml', 'deberta_infer.py');
  const args       = [scriptPath, '--texts', JSON.stringify(texts), '--labels', LABELS.join(',')];

  console.log('[DeBERTa] Running:', pythonCmd, args[0]);

  return new Promise(resolve => {
    let stdout = '';

    const proc  = spawn(pythonCmd, args);

    const timer = setTimeout(() => {
      proc.kill();
      console.error('[DeBERTa] Timeout after 120s');
      resolve(null);
    }, 120000);

    proc.stdout.on('data', d => { stdout += d.toString(); });

    proc.stderr.on('data', d => {
      console.error('[DeBERTa stderr]', d.toString().trimEnd());
    });

    proc.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        console.error('[DeBERTa] Exit code:', code);
        resolve(null);
        return;
      }
      try {
        const raw = JSON.parse(stdout.trim());
        if (!Array.isArray(raw) || raw.length === 0) {
          console.error('[DeBERTa] Empty or non-array response');
          resolve(null);
          return;
        }
        // Map each { label, score } — translate label to our short key
        const results = raw.map(item => ({
          label: LABEL_MAP[item.label] || 'renewable',
          score: typeof item.score === 'number' ? item.score : 0,
        }));
        resolve(results);
      } catch (e) {
        console.error('[DeBERTa] JSON parse error:', e.message, '| stdout:', stdout.substring(0, 200));
        resolve(null);
      }
    });

    proc.on('error', e => {
      clearTimeout(timer);
      console.error('[DeBERTa] Spawn error:', e.message);
      resolve(null);
    });
  });
}

module.exports = { classifyWithDeBERTa };
