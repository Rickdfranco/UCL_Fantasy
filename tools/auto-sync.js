// Syncs the live standings every 15 minutes through a logged-in Safari tab, like tapping the bookmarklet.
// No UEFA login details are stored: Safari makes the request with its own session.
// Usage: node tools/auto-sync.js [--dry-run]   one sync now (--dry-run shows it without saving)
//        node tools/auto-sync.js --install     run it every 15 minutes in the background
//        node tools/auto-sync.js --uninstall   stop the background runs
// Needs Safari open on gaming.uefa.com (logged in) with Develop → "Allow JavaScript from Apple Events" ticked.

require('./env');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { mapMembers } = require('../api/_lib');
const sync = require('../api/sync');

const root = path.join(__dirname, '..');
const dir = path.join(root, '.autosync');
const stateFile = path.join(dir, 'state.json');
const LABEL = 'com.uclfantasy.autosync';
const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

const log = (msg) => console.log(`${new Date().toLocaleString()}  ${msg}`);
const osa = (lines, ...args) => execFileSync('osascript', [...lines.flatMap((l) => ['-e', l]), ...args], { encoding: 'utf8' }).trim();
const notify = (msg) => { try { osa(['on run argv', 'display notification (item 1 of argv) with title "Fantasy sync"', 'end run'], msg); } catch {} };

// Runs a same-origin request inside the first gaming.uefa.com tab, so Safari sends its own login cookies.
// Never launches Safari: if it isn't open, the run is skipped.
function fetchViaSafari(url) {
  const js = `(function(){try{var x=new XMLHttpRequest();x.open('GET',${JSON.stringify(url)}+'&buster='+Date.now(),false);x.send();return x.responseText;}catch(e){return 'ERR:'+e.message;}})()`;
  return osa([
    'on run argv',
    'if application "Safari" is not running then return "SKIP:Safari isn’t open"',
    'tell application "Safari"',
    'repeat with w in windows',
    'try',
    'repeat with t in tabs of w',
    'if URL of t contains "gaming.uefa.com" then return do JavaScript (item 1 of argv) in t',
    'end repeat',
    'end try',
    'end repeat',
    'end tell',
    'return "SKIP:no gaming.uefa.com tab open in Safari"',
    'end run',
  ], js);
}

function save(league) {
  return new Promise((resolve) => {
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json: resolve, end() {} };
    Promise.resolve(sync({ method: 'POST', body: { key: process.env.SYNC_KEY, league } }, res))
      .catch((e) => resolve({ ok: false, error: e.message }));
  });
}

const readState = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return {}; } };
const writeState = (s) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(s, null, 2)); };

// Notifies only when things go wrong or come right again, not on every run
function report(state, problem) {
  if (problem && state.problem !== problem) notify(problem);
  if (!problem && state.problem) notify('Syncing again ✅');
  state.problem = problem || null;
}

async function run(dry) {
  const url = process.env.UEFA_LEAGUE_URL;
  if (!url) { log('Add UEFA_LEAGUE_URL to .env.local first.'); process.exitCode = 1; return; }
  const state = readState();

  let text;
  try { text = fetchViaSafari(url); }
  catch (e) {
    const msg = String(e.stderr || e.message);
    const problem = /Allow JavaScript from Apple Events/i.test(msg)
      ? 'In Safari, turn on Develop → “Allow JavaScript from Apple Events”.'
      : /not allowed|-1743/i.test(msg)
        ? 'Allow Terminal/node to control Safari in System Settings → Privacy & Security → Automation.'
        : `Couldn’t reach Safari: ${msg.split('\n')[0]}`;
    log(problem); report(state, problem); writeState(state); process.exitCode = 1; return;
  }
  if (text.startsWith('SKIP:')) { log(`Skipped: ${text.slice(5)}.`); return; }

  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!json || text.startsWith('ERR:') || json.meta?.success === false) {
    const problem = json?.meta?.retVal === -70 || /not authori[sz]ed/i.test(json?.meta?.message || '')
      ? 'UEFA logged you out. Log back in on gaming.uefa.com in Safari.'
      : `UEFA sent something unexpected: ${(json?.meta?.message || text).slice(0, 80)}`;
    log(problem); report(state, problem); writeState(state); process.exitCode = 1; return;
  }

  const m = mapMembers(json);
  if (dry) {
    log(`${m.leagueName}: standings through matchday ${m.latestMd} (dry run, nothing saved)`);
    m.members.forEach((x) => console.log(`  ${x.name}: ${x.mdPoints ?? '-'} this matchday, ${x.official?.total ?? '-'} total`));
    return;
  }

  // Skip the write when nothing has changed since the last save
  const hash = crypto.createHash('sha1').update(JSON.stringify(json.data?.value?.rest || json)).digest('hex');
  if (hash === state.hash) { log('No changes.'); report(state, null); writeState(state); return; }

  const out = await save(text);
  if (out.ok) { log(`Saved. ${out.summary}`); state.hash = hash; report(state, null); }
  else { log(`Save failed: ${out.error}`); report(state, `Save failed: ${out.error}`); process.exitCode = 1; }
  writeState(state);
}

function install() {
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.dirname(plist), { recursive: true });
  const logFile = path.join(dir, 'log.txt');
  fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${process.execPath}</string><string>${__filename}</string></array>
  <key>WorkingDirectory</key><string>${root}</string>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${logFile}</string>
  <key>StandardErrorPath</key><string>${logFile}</string>
</dict></plist>
`);
  const target = `gui/${process.getuid()}`;
  try { execFileSync('launchctl', ['bootout', target, plist], { stdio: 'ignore' }); } catch {}
  execFileSync('launchctl', ['bootstrap', target, plist]);
  console.log(`Installed. Syncs every 15 minutes while you're logged in to your Mac. Log: ${logFile}`);
}

function uninstall() {
  try { execFileSync('launchctl', ['bootout', `gui/${process.getuid()}`, plist], { stdio: 'ignore' }); } catch {}
  fs.rmSync(plist, { force: true });
  console.log('Stopped. Background syncing is off.');
}

const args = process.argv.slice(2);
if (args.includes('--install')) install();
else if (args.includes('--uninstall')) uninstall();
else run(args.includes('--dry-run'));
