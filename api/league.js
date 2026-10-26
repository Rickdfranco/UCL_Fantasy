// GET /api/league  ->  normalized data for the whole group
const { isDemo, loadLive, loadDemo } = require('./_lib');

module.exports = async (req, res) => {
  try {
    const data = isDemo() ? loadDemo() : await loadLive();
    // Cache at the edge for 5 minutes so friends refreshing at once don't hammer the game's servers.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=900');
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Could not load data from the fantasy game.', detail: String(err.message || err) });
  }
};
