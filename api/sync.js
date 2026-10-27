// POST /api/sync  { key, league, info? }  saves a copy of the league (and optionally the deadline feed)
// GET  /api/sync  setup status for the Sync page
const { storeEnabled, setSnapshot, getSnapshot } = require('./_store');
const { findMemberArray, findValue, mapMembers, mdRecord } = require('./_lib');

// Accepts pasted text with extra bits around the JSON (e.g. browser extension labels
// that get copied with Ctrl+A) by keeping only the part from the first { to the last }.
function parse(v) {
  if (typeof v !== 'string') return v;
  const start = v.indexOf('{'), end = v.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON found');
  return JSON.parse(v.slice(start, end + 1));
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    let last = null;
    if (storeEnabled()) { try { last = (await getSnapshot('league'))?.syncedAt || null; } catch {} }
    return res.status(200).json({
      storeReady: storeEnabled(),
      keyConfigured: !!process.env.SYNC_KEY,
      leagueUrl: process.env.UEFA_LEAGUE_URL || '',
      lastSync: last,
    });
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Use POST' });

  if (!storeEnabled()) return res.status(500).json({ ok: false, error: 'Storage isn’t set up yet. Add Upstash Redis from the Storage tab in Vercel.' });
  if (!process.env.SYNC_KEY) return res.status(500).json({ ok: false, error: 'Add a SYNC_KEY environment variable in Vercel first.' });

  let body;
  try { body = parse(req.body) || {}; } catch { return res.status(400).json({ ok: false, error: 'That isn’t valid data.' }); }
  if (String(body.key || '').trim() !== process.env.SYNC_KEY) return res.status(401).json({ ok: false, error: 'Wrong sync key.' });

  let league, info;
  try { league = parse(body.league); } catch { return res.status(400).json({ ok: false, error: 'The league data isn’t valid JSON. Copy the whole response and try again.' }); }
  const members = findMemberArray(league) || [];
  if (!members.length) return res.status(400).json({ ok: false, error: 'This doesn’t look like your league standings (no members found).' });
  if (body.info) {
    try { info = parse(body.info); } catch { return res.status(400).json({ ok: false, error: 'The deadline data isn’t valid JSON.' }); }
  }

  const syncedAt = new Date().toISOString();
  const mapped = mapMembers(league);
  const md = mapped.latestMd;

  // Season history: one entry per matchday, refreshed whenever that matchday is synced again
  const history = (await getSnapshot('history').catch(() => null)) || { mds: {} };
  if (md) {
    history.mds[md] = { members: mapped.members.map(mdRecord), savedAt: syncedAt };
    await setSnapshot('history', history);
  }
  // Only the overall feed replaces the current standings; a single past matchday just fills history
  if (!mapped.mdSpecific) await setSnapshot('league', { raw: league, syncedAt });
  if (info) await setSnapshot('info', { raw: info, syncedAt });

  const saved = Object.keys(history.mds).map(Number).sort((a, b) => a - b);
  const what = mapped.mdSpecific ? `matchday ${md} added to the history` : `${mapped.leagueName}: ${mapped.members.length} members${md ? `, through matchday ${md}` : ''}`;
  return res.status(200).json({ ok: true, summary: `${what}${info ? ', deadline updated' : ''}. Matchdays saved: ${saved.join(', ') || 'none'}` });
};
