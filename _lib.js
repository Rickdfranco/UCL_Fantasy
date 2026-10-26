// Data layer for the app.
// Everything specific to the fantasy game's (unofficial) endpoints lives in this file,
// so if the game changes its data format, this is the only file to fix.

const config = require('../league.config.json');

const TEAM_URL = process.env.UEFA_TEAM_URL || '';      // template with {teamId} and {md}
const COOKIE = process.env.UEFA_COOKIE || '';          // optional, your logged-in session cookie
const LEAGUE_URL = process.env.UEFA_LEAGUE_URL || '';  // optional: your private league's standings
const MAX_MD = parseInt(process.env.MAX_MATCHDAY || '17', 10);

const configFilledIn = () => !config.managers.some((m) => String(m.teamId).startsWith('PASTE_'));
// Live mode needs the team URL plus either the league URL or a filled-in config file.
const isDemo = () => !TEAM_URL || (!LEAGUE_URL && !configFilledIn());

function buildUrl(teamId, md) {
  return TEAM_URL.replace(/\{teamId\}/g, encodeURIComponent(teamId)).replace(/\{md\}/g, md);
}

async function getJson(url, what) {
  const headers = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (fantasy-group-app)' };
  if (COOKIE) headers.Cookie = COOKIE;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`The game returned ${res.status} for ${what}`);
  return res.json();
}

const fetchRaw = (teamId, md) => getJson(buildUrl(teamId, md), `team ${teamId}, matchday ${md}`);
const fetchLeagueRaw = () => getJson(LEAGUE_URL, 'the league standings');

// ---------- Normalizing ----------
// The game's JSON uses short field names that change between seasons, so we look for
// the most likely candidates. If something comes out wrong, open /api/debug and adjust these lists.
const KEYS = {
  points: ['gdPoints', 'gdPts', 'points', 'pts', 'totPts', 'totalPoints'],
  name: ['pDName', 'pName', 'pFName', 'playerName', 'displayName', 'name'],
  club: ['tSCode', 'cCode', 'tName', 'teamName', 'club'],
  captain: ['isCaptain', 'captain', 'cap', 'isCap'],
  bench: ['isBench', 'bench', 'onBench', 'isSub'],
  total: ['gdPoints', 'gdPts', 'matchdayPoints', 'totalGdPoints', 'points'],
  // League standings
  memberId: ['guid', 'userGuid', 'teamId', 'tId', 'teamGuid', 'entryId', 'id'],
  memberName: ['userName', 'fullName', 'uName', 'managerName', 'name'],
  memberTeam: ['teamName', 'tName', 'entryName'],
  rank: ['rank', 'curRank', 'rno', 'position'],
  overall: ['totalPoints', 'ovPoints', 'totPts', 'overallPoints', 'points'],
  leagueName: ['leagueName', 'lgName', 'leagueTitle'],
};

const pick = (obj, list) => {
  for (const k of list) if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  return undefined;
};

// Find the first array of objects that looks like a list of players.
function findPlayerArray(node, depth = 0) {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) {
    if (node.length && typeof node[0] === 'object' && pick(node[0], KEYS.name) !== undefined &&
        pick(node[0], KEYS.points) !== undefined) return node;
    for (const item of node) { const f = findPlayerArray(item, depth + 1); if (f) return f; }
    return null;
  }
  if (typeof node === 'object') {
    for (const v of Object.values(node)) { const f = findPlayerArray(v, depth + 1); if (f) return f; }
  }
  return null;
}

// Find the first array of objects that looks like a league table.
function findMemberArray(node, depth = 0) {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) {
    if (node.length && typeof node[0] === 'object' && pick(node[0], KEYS.memberId) !== undefined &&
        (pick(node[0], KEYS.rank) !== undefined || pick(node[0], KEYS.overall) !== undefined)) return node;
    for (const item of node) { const f = findMemberArray(item, depth + 1); if (f) return f; }
    return null;
  }
  if (typeof node === 'object') {
    for (const v of Object.values(node)) { const f = findMemberArray(v, depth + 1); if (f) return f; }
  }
  return null;
}

function findValue(node, keys, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 4) return undefined;
  const direct = pick(node, keys);
  if (typeof direct === 'string' && direct) return direct;
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) { const f = findValue(v, keys, depth + 1); if (f) return f; }
  }
  return undefined;
}

// Who is in the group: from the league standings if available, otherwise from league.config.json.
async function getMembers() {
  if (!LEAGUE_URL) {
    return { leagueName: config.leagueName, members: config.managers.map((m) => ({ ...m, official: null })) };
  }
  const raw = await fetchLeagueRaw();
  const rows = findMemberArray(raw) || [];
  if (!rows.length) throw new Error('No members found in the league standings. Check UEFA_LEAGUE_URL with /api/debug?league=1');
  // Names in league.config.json (matched by team ID) override what the game shows, if you prefer nicknames.
  const nick = new Map(config.managers.map((m) => [String(m.teamId), m]));
  const members = rows.map((r) => {
    const teamId = String(pick(r, KEYS.memberId));
    const o = nick.get(teamId);
    const rank = Number(pick(r, KEYS.rank));
    const total = Number(pick(r, KEYS.overall));
    return {
      teamId,
      name: o?.name || String(pick(r, KEYS.memberName) ?? 'Manager'),
      teamName: o?.teamName || String(pick(r, KEYS.memberTeam) ?? ''),
      official: { rank: Number.isFinite(rank) ? rank : null, total: Number.isFinite(total) ? total : null },
    };
  });
  return { leagueName: findValue(raw, KEYS.leagueName) || config.leagueName, members };
}

function truthy(v) { return v === true || v === 1 || v === '1' || v === 'true'; }

function normalizeMatchday(raw) {
  const arr = findPlayerArray(raw) || [];
  const players = arr.map((p) => ({
    name: String(pick(p, KEYS.name) ?? 'Unknown'),
    club: String(pick(p, KEYS.club) ?? ''),
    points: Number(pick(p, KEYS.points) ?? 0),
    captain: truthy(pick(p, KEYS.captain)),
    bench: truthy(pick(p, KEYS.bench)),
  }));
  const root = raw && (raw.data?.value || raw.data || raw);
  const reported = Number(pick(root, KEYS.total));
  const computed = players.filter((p) => !p.bench)
    .reduce((s, p) => s + p.points * (p.captain ? 2 : 1), 0);
  return { points: Number.isFinite(reported) && reported > 0 ? reported : computed, players };
}

async function loadLive() {
  const { leagueName, members } = await getMembers();
  const managers = await Promise.all(members.map(async (m) => {
    const mds = Array.from({ length: MAX_MD }, (_, i) => i + 1);
    const results = await Promise.all(mds.map(async (md) => {
      try { return { md, ...normalizeMatchday(await fetchRaw(m.teamId, md)) }; }
      catch { return null; }
    }));
    return { id: String(m.teamId), name: m.name, teamName: m.teamName || '', official: m.official, history: results.filter(Boolean) };
  }));
  // Keep only matchdays where someone actually scored.
  const played = new Set();
  managers.forEach((m) => m.history.forEach((h) => { if (h.points !== 0) played.add(h.md); }));
  managers.forEach((m) => { m.history = m.history.filter((h) => played.has(h.md)); });
  return {
    mode: 'live',
    source: LEAGUE_URL ? 'league' : 'config',
    leagueName,
    updatedAt: new Date().toISOString(),
    matchdays: [...played].sort((a, b) => a - b),
    managers,
  };
}

// ---------- Demo data (used until the config and URL are filled in) ----------
function seeded(seed) { let s = seed; return () => (s = (s * 9301 + 49297) % 233280) / 233280; }

function loadDemo() {
  const rnd = seeded(7);
  const pool = [
    ['Mbappé', 'RMA'], ['Kane', 'BAY'], ['Haaland', 'MCI'], ['Salah', 'LIV'], ['Yamal', 'BAR'],
    ['Saka', 'ARS'], ['Musiala', 'BAY'], ['Vinícius Jr', 'RMA'], ['Rice', 'ARS'], ['Lautaro', 'INT'],
    ['Pedri', 'BAR'], ['Dembélé', 'PSG'], ['Van Dijk', 'LIV'], ['Hakimi', 'PSG'], ['Rúben Dias', 'MCI'],
    ['Courtois', 'RMA'], ['Raya', 'ARS'], ['Wirtz', 'LIV'], ['Bellingham', 'RMA'], ['Kvaratskhelia', 'PSG'],
  ];
  const names = [['Alex', 'Galácticos FC'], ['Sam', 'Late Winner XI'], ['Jordan', 'Park the Bus'], ['Riley', 'VAR Check Pending']];
  const matchdays = [1, 2, 3, 4, 5, 6];
  // Each real player scores the same for everyone who owns him on a given matchday.
  const scores = new Map(matchdays.map((md) => [md, new Map(pool.map(([n]) =>
    [n, Math.max(-1, Math.round(rnd() * rnd() * 14) + (rnd() > 0.6 ? 2 : 0))]))]));
  const managers = names.map(([name, teamName], i) => ({
    id: `demo-${i}`, name, teamName,
    history: matchdays.map((md) => {
      const squad = [...pool].sort(() => rnd() - 0.5).slice(0, 15);
      const cap = Math.floor(rnd() * 11);
      const players = squad.map(([n, c], j) => ({
        name: n, club: c, bench: j >= 11, captain: j === cap,
        points: scores.get(md).get(n),
      }));
      const points = players.filter((p) => !p.bench).reduce((s, p) => s + p.points * (p.captain ? 2 : 1), 0);
      return { md, points, players };
    }),
  }));
  return { mode: 'demo', leagueName: 'Demo league', updatedAt: new Date().toISOString(), matchdays, managers };
}

module.exports = { isDemo, loadLive, loadDemo, fetchRaw, fetchLeagueRaw, buildUrl, config, LEAGUE_URL };
