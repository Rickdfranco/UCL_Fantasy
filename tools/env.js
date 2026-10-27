// Loads settings from .env.local (kept out of git) so local tools can reach the same
// Upstash database as the live app. Variables already set in the shell win.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
