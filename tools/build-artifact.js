// Bundles the app UI into one self-contained HTML file for previewing as a Claude artifact.
// Same index.html, styles.css and app.js as the live app; only the data source differs:
// demo data is built in, and real data can be pasted in from /api/league.
// Usage: node tools/build-artifact.js [output.html]

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const demo = require(path.join(root, 'api/_lib.js')).loadDemo();
demo.mode = 'preview';

let html = read('public/index.html');
const css = read('public/styles.css');
const app = read('public/app.js')
  .replace(/^\s*if \('serviceWorker' in navigator\).*$/m, '  // (Service worker is skipped in the preview.)');

const preview = `
<style>
  .pv-toggle { position: fixed; right: 14px; bottom: calc(14px + env(safe-area-inset-bottom, 0px)); z-index: 20;
    background: var(--ink); color: var(--paper); border: 0; border-radius: 999px; padding: 10px 16px; font-weight: 650;
    box-shadow: 0 6px 18px -6px rgba(0,0,0,0.4); }
  .pv-panel { position: fixed; inset: auto 0 0 0; z-index: 30; background: var(--surface); color: var(--ink);
    border-top: 1px solid var(--line); padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px));
    box-shadow: 0 -10px 30px -12px rgba(0,0,0,0.35); }
  .pv-panel[hidden] { display: none; }
  .pv-inner { max-width: 720px; margin: 0 auto; display: grid; gap: 10px; }
  .pv-inner h3 { margin: 0; font-size: 1.05rem; }
  .pv-inner p { margin: 0; font-size: 0.9rem; color: var(--muted); }
  .pv-inner textarea { width: 100%; min-height: 120px; font: 0.85rem/1.4 ui-monospace, Menlo, Consolas, monospace;
    background: var(--paper); color: var(--ink); border: 1px solid var(--line); border-radius: 10px; padding: 10px; resize: vertical; }
  .pv-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .pv-row button { border: 1.5px solid var(--line); background: transparent; border-radius: 999px; padding: 8px 14px; font-weight: 600; }
  .pv-row button.primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .pv-msg { min-height: 1.2em; }
  main { padding-bottom: 90px; }
</style>
<button class="pv-toggle" id="pv-toggle" aria-expanded="false" aria-controls="pv-panel">Preview data</button>
<section class="pv-panel" id="pv-panel" hidden aria-label="Preview data">
  <div class="pv-inner">
    <h3 id="pv-status">Showing demo data</h3>
    <p>To preview with your real league, open your-app.vercel.app/api/league, copy everything on the page, and paste it here. It stays in this browser only.</p>
    <textarea id="pv-input" spellcheck="false" placeholder='{"leagueName": "…", "matchdays": […], "managers": […]}'></textarea>
    <div class="pv-row">
      <button class="primary" id="pv-use">Use pasted data</button>
      <button id="pv-reset">Back to demo data</button>
      <button id="pv-close">Close</button>
    </div>
    <p class="pv-msg" id="pv-msg" role="status"></p>
  </div>
</section>
<script>
(() => {
  const KEY = 'fantasy-preview-data';
  const DEMO = ${JSON.stringify(demo)};
  const stored = () => { try { const v = localStorage.getItem(KEY); return v ? JSON.parse(v) : null; } catch { return null; } };
  const valid = (d) => d && Array.isArray(d.matchdays) && Array.isArray(d.managers) && d.managers.length > 0;

  // The app asks for /api/league; answer from pasted data or the built-in demo.
  const realFetch = window.fetch.bind(window);
  window.fetch = (url, opts) => {
    if (String(url).includes('/api/league')) {
      const data = stored() || { ...DEMO, updatedAt: new Date().toISOString() };
      return Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return realFetch(url, opts);
  };

  const $ = (id) => document.getElementById(id);
  const status = () => { const d = stored(); $('pv-status').textContent = d ? 'Showing your pasted data (' + d.managers.length + ' managers)' : 'Showing demo data'; };
  const refresh = () => { document.getElementById('refresh')?.click(); status(); };
  const toggle = (open) => { $('pv-panel').hidden = !open; $('pv-toggle').setAttribute('aria-expanded', String(open)); if (open) status(); };

  document.addEventListener('DOMContentLoaded', () => {
    $('pv-toggle').onclick = () => toggle($('pv-panel').hidden);
    $('pv-close').onclick = () => toggle(false);
    $('pv-use').onclick = () => {
      let d;
      try { d = JSON.parse($('pv-input').value); } catch { $('pv-msg').textContent = 'That isn’t valid JSON. Copy the whole page from /api/league and try again.'; return; }
      if (!valid(d)) { $('pv-msg').textContent = 'This doesn’t look like league data. It needs matchdays and managers.'; return; }
      try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { $('pv-msg').textContent = 'Couldn’t save in this browser, so it will reset on reload.'; }
      $('pv-msg').textContent = 'Loaded your league.';
      $('pv-input').value = '';
      refresh();
    };
    $('pv-reset').onclick = () => { try { localStorage.removeItem(KEY); } catch {} $('pv-msg').textContent = 'Back to demo data.'; refresh(); };
  });
})();
</script>`;

html = html
  .replace(/\s*<link rel="manifest"[^>]*>/, '')
  .replace(/\s*<link rel="icon"[^>]*>/, '')
  .replace(/\s*<link rel="apple-touch-icon"[^>]*>/, '')
  .replace('<link rel="stylesheet" href="/styles.css">', () => `<style>\n${css}\n</style>`)
  .replace('<script src="/app.js"></script>', () => `${preview}\n<script>\n${app}\n</script>`);

const out = process.argv[2] || path.join(root, 'fantasy-group-preview.html');
fs.writeFileSync(out, html);
console.log('Wrote', out, `(${Math.round(html.length / 1024)} KB)`);
