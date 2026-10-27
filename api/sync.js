// POST /api/sync  { key, league, info? }  saves a copy of the league (and optionally the deadline feed)
// GET  /api/sync  setup status for the Sync page
const { storeEnabled, setSnapshot, getSnapshot } = require('./_store');
const { findMemberArray, findValue } = require('./_lib');

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

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
  await setSnapshot('league', { raw: league, syncedAt });
  if (info) await setSnapshot('info', { raw: info, syncedAt });
  const name = findValue(league, ['leagueName']) || 'League';
  const md = league?.data?.value?.lp_gamedayId;
  return res.status(200).json({ ok: true, summary: `${name}: ${members.length} members${md ? `, through matchday ${md}` : ''}${info ? ', deadline updated' : ''}` });
};
