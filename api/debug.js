// Shows the raw JSON the game returns, so you can check the field names used in _lib.js.
//   League standings: /api/debug?key=YOUR_DEBUG_KEY&league=1
//   Schedule:         /api/debug?key=YOUR_DEBUG_KEY&schedule=1
//   One team:         /api/debug?key=YOUR_DEBUG_KEY&teamId=123&md=1
const { fetchRaw, fetchLeagueRaw, buildUrl, LEAGUE_URL, SCHEDULE_URL, withBuster, getJson } = require('./_lib');

module.exports = async (req, res) => {
  const { key, teamId, md = '1', league, schedule } = req.query || {};
  if (!process.env.DEBUG_KEY || key !== process.env.DEBUG_KEY) {
    return res.status(403).json({ error: 'Set DEBUG_KEY in your environment and pass it as ?key=' });
  }
  for (const [flag, url, what] of [[schedule, SCHEDULE_URL, 'UEFA_SCHEDULE_URL']]) {
    if (!flag) continue;
    if (!url) return res.status(400).json({ error: `${what} is not set.` });
    try { return res.status(200).json({ url, raw: await getJson(withBuster(url), what) }); }
    catch (err) { return res.status(502).json({ url, error: String(err.message || err) }); }
  }
  if (league) {
    if (!LEAGUE_URL) return res.status(400).json({ error: 'UEFA_LEAGUE_URL is not set.' });
    try { return res.status(200).json({ url: LEAGUE_URL, raw: await fetchLeagueRaw() }); }
    catch (err) { return res.status(502).json({ url: LEAGUE_URL, error: String(err.message || err) }); }
  }
  if (!teamId) return res.status(400).json({ error: 'Add ?teamId= (or ?league=1) to the URL.' });
  try {
    res.status(200).json({ url: buildUrl(teamId, md), raw: await fetchRaw(teamId, md) });
  } catch (err) {
    res.status(502).json({ url: buildUrl(teamId, md), error: String(err.message || err) });
  }
};
