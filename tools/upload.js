// Saves a pasted league response to the database, the same way the Sync page does.
// Usage: node tools/upload.js <file.json> [matchday] [--dry-run]
//   matchday: needed for a past matchday's standings (the game often labels them 0)
//   --dry-run: show what would be saved without writing anything

require('./env');
const fs = require('fs');
const { mapMembers } = require('../api/_lib');
const sync = require('../api/sync');

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const [file, md] = args.filter((a) => a !== '--dry-run');
if (!file) { console.error('Usage: node tools/upload.js <file.json> [matchday] [--dry-run]'); process.exit(1); }

const league = fs.readFileSync(file, 'utf8');

if (dry) {
  const json = JSON.parse(league.slice(league.indexOf('{'), league.lastIndexOf('}') + 1));
  const m = mapMembers(json, md ? Number(md) : null);
  console.log(`${m.leagueName}: ${m.mdSpecific ? `past matchday ${m.latestMd ?? '(unknown, add the matchday number)'}` : `current standings through matchday ${m.latestMd}`}`);
  m.members.forEach((x) => console.log(`  ${x.name}: ${x.mdPoints ?? '-'} pts this matchday${x.official?.total != null ? `, ${x.official.total} total` : ''}`));
  process.exit(0);
}

const res = {
  setHeader() {},
  status(code) { this.code = code; return this; },
  json(data) { console.log(data.ok ? `Saved. ${data.summary}` : `Failed (${this.code}): ${data.error}`); process.exitCode = data.ok ? 0 : 1; },
  end() {},
};
sync({ method: 'POST', body: { key: process.env.SYNC_KEY, league, md: md || undefined } }, res);
