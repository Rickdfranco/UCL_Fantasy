// GET /api/league  ->  normalized data for the whole group
const { isDemo, loadLive, loadDemo } = require('./_lib');

module.exports = async (req, res) => {
  try {
    const data = isDemo() ? loadDemo() : await loadLive();
    // Short edge cache so a fresh sync shows up within about 30 seconds.
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Could not load data from the fantasy game.', detail: String(err.message || err) });
  }
};
