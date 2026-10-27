// Data layer for the app.
// Everything specific to the fantasy game's (unofficial) endpoints lives in this file,
// so if the game changes its data format, this is the only file to fix.

const config = require('../league.config.json');
const { storeEnabled, getSnapshot } = require('./_store');

const TEAM_URL = process.env.UEFA_TEAM_URL || '';      // template with {teamId} and {md}
const COOKIE = process.env.UEFA_COOKIE || '';          // optional, your logged-in session cookie
const LEAGUE_URL = process.env.UEFA_LEAGUE_URL || '';  // optional: your private league's standings
const SCHEDULE_URL = process.env.UEFA_SCHEDULE_URL || ''; // optional: matchdays with deadlines
const MANUAL_DEADLINE = process.env.NEXT_DEADLINE || '';  // optional fallback, e.g. 2026-11-04T17:45:00Z
// The game writes deadlines like "11/03/2026 18:45:00" with no timezone; they follow Central European Time.
const DEADLINE_TZ = process.env.UEFA_DEADLINE_TZ || 'Europe/Paris';
const MAX_MD = parseInt(process.env.MAX_MATCHDAY || '17', 10);

const configFilledIn = () => !config.managers.some((m) => String(m.teamId).startsWith('PASTE_'));
// Live mode needs the team URL plus either the league URL or a filled-in config file.
// Live mode needs the league URL, or the team URL plus a filled-in config file.
const isDemo = () => !storeEnabled() && !LEAGUE_URL && (!TEAM_URL || !configFilledIn());

function buildUrl(teamId, md) {
  return TEAM_URL.replace(/\{teamId\}/g, encodeURIComponent(teamId)).replace(/\{md\}/g, md);
}

// Look like a normal browser visit from the fantasy site; UEFA's bot protection can refuse anything else.
const BROWSER_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  Referer: 'https://gaming.uefa.com/en/uclfantasy/',
  Origin: 'https://gaming.uefa.com',
};

async function getJson(url, what) {
  const headers = { ...BROWSER_HEADERS };
  if (COOKIE) headers.Cookie = COOKIE;
  let res;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    } catch (err) {
      if (attempt === 2) {
        const c = err.cause || {};
        const why = err.name === 'TimeoutError' ? 'timed out after 10s'
          : [c.code, c.message].filter(Boolean).join(': ') || err.message;
        throw new Error(`Couldn't reach the game for ${what} (${why})`);
      }
      continue;
    }
    if (res.ok || res.status < 500) break; // retry once on a server hiccup
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`The game returned ${res.status} for ${what}${res.status === 401 || res.status === 403 ? ' (access refused)' : ''}`);
  try { return JSON.parse(text); }
  catch { throw new Error(`The game sent a web page instead of data for ${what} (often a bot check): ${text.slice(0, 80).replace(/\s+/g, ' ')}`); }
}

const fetchRaw = (teamId, md) => getJson(buildUrl(teamId, md), `team ${teamId}, matchday ${md}`);
// The game adds a random "buster" value to stop caching; we set a fresh one each time.
function withBuster(url) {
  try { const u = new URL(url); u.searchParams.set('buster', Date.now().toString(36)); return u.toString(); }
  catch { return url; }
}
const fetchLeagueRaw = () => getJson(withBuster(LEAGUE_URL), 'the league standings');

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
// Turns a league standings response into members. Works for the overall feed and for a
// single-matchday feed (where pointsGamedayId names the matchday and gamedayPoints holds its scores).
function mapMembers(raw) {
  const rows = findMemberArray(raw) || [];
  if (!rows.length) throw new Error('No members found in the league standings.');
  const nick = new Map(config.managers.map((m) => [String(m.teamId), m]));
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && v !== '' && v !== null ? n : null; };
  const value = raw?.data?.value || {};
  const mdSpecific = (num(value.pointsGamedayId) || 0) > 0;
  const members = rows.map((r) => {
    const teamId = String(pick(r, KEYS.memberId));
    const o = nick.get(teamId);
    return {
      teamId,
      name: (o?.name || String(pick(r, KEYS.memberName) ?? 'Manager')).trim(),
      teamName: (o?.teamName || String(pick(r, KEYS.memberTeam) ?? '')).trim(),
      official: { rank: num(pick(r, KEYS.rank)), total: num(pick(r, KEYS.overall)) },
      // Extras from the standings feed (field names as of the 2026/27 game)
      worldRank: num(r.overAllRank),
      mdPoints: mdSpecific ? (num(r.gamedayPoints) ?? num(r.currentGamedayPoints)) : num(r.currentGamedayPoints),
      topPerformer: r.topPerformerId ? { id: String(r.topPerformerId), name: String(r.topPerformer || '').trim(), points: num(r.topPerformerValue) ?? 0 } : null,
      captainId: r.mdCaptain ? String(r.mdCaptain) : null,
      playerIds: Array.isArray(r.userPlayers) ? r.userPlayers.map(String) : [],
      transfers: num(r.mdTransfers),
      trend: ({ 2: 'up', 3: 'down', 1: 'same' })[String(r.trend)] || null, // game's own movement arrow
      chips: { wildcard: num(r.wildCardMD) || null, limitless: num(r.limitlessMD) || null },
    };
  });
  const latestMd = mdSpecific ? num(value.pointsGamedayId)
    : num(value.lp_gamedayId) || num(findValue(raw, ['lp_gamedayId', 'gamedayId']));
  return { leagueName: findValue(raw, KEYS.leagueName) || config.leagueName, members, latestMd, mdSpecific };
}

// What a member did in one matchday, kept in the season history.
const mdRecord = (m) => ({ teamId: m.teamId, mdPoints: m.mdPoints, topPerformer: m.topPerformer, captainId: m.captainId, playerIds: m.playerIds });

async function getMembers(snapshotRaw) {
  if (!LEAGUE_URL && !snapshotRaw) {
    return { leagueName: config.leagueName, members: config.managers.map((m) => ({ ...m, official: null })) };
  }
  return mapMembers(snapshotRaw || await fetchLeagueRaw());
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


// ---------- Deadlines ----------
// Generic finder: first array of objects that has a key from each list.
function findArrayWith(node, listA, listB, depth = 0) {
  if (!node || depth > 7) return null;
  if (Array.isArray(node)) {
    if (node.length && typeof node[0] === 'object' && pick(node[0], listA) !== undefined && pick(node[0], listB) !== undefined) return node;
    for (const item of node) { const f = findArrayWith(item, listA, listB, depth + 1); if (f) return f; }
    return null;
  }
  if (typeof node === 'object') {
    for (const v of Object.values(node)) { const f = findArrayWith(v, listA, listB, depth + 1); if (f) return f; }
  }
  return null;
}

const SKEYS = {
  md: ['matchdayId', 'mdId', 'gdNo', 'gdId', 'gamedayId', 'id'],
  deadline: ['deadline', 'deadlineDate', 'gdDeadline', 'lockTime', 'deadlineTime', 'deadLine'],
  kickoff: ['firstMatchDate', 'firstKickoff', 'kickoff', 'startDate', 'startTime', 'matchDate'],
};

// Milliseconds a timezone is ahead of UTC at a given moment.
function tzOffset(ts, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(ts).map((p) => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - ts;
}

function parseDate(v) {
  if (!v) return null;
  // "MM/DD/YYYY HH:mm:ss" in the game's timezone
  const m = typeof v === 'string' && v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const guess = Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +(m[6] || 0));
    let ts = guess;
    try {
      const tz = DEADLINE_TZ.toUpperCase() === 'UTC' ? 'UTC' : DEADLINE_TZ;
      ts = guess - tzOffset(guess, tz);
      ts = guess - tzOffset(ts, tz); // settle around daylight-saving changes
    } catch { /* unknown timezone name: treat as UTC */ }
    return new Date(ts).toISOString();
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function loadDeadline() {
  if (MANUAL_DEADLINE) { const d = parseDate(MANUAL_DEADLINE); if (d && new Date(d) > Date.now()) return { md: null, deadline: d, kickoff: null }; }
  let raw = null;
  if (storeEnabled()) raw = (await getSnapshot('info').catch(() => null))?.raw || null;
  if (!raw && SCHEDULE_URL && !storeEnabled()) raw = await getJson(withBuster(SCHEDULE_URL), 'the matchday schedule');
  if (!raw) return null;
  const now = Date.now();
  const toEntry = (g) => ({ md: Number(pick(g, SKEYS.md)) || null, deadline: parseDate(pick(g, SKEYS.deadline)), kickoff: parseDate(pick(g, SKEYS.kickoff)) });
  // Single upcoming matchday (the game's player-list info feed), or a list of matchdays
  const single = raw?.data?.value && pick(raw.data.value, SKEYS.deadline) !== undefined ? [toEntry(raw.data.value)] : [];
  const list = (findArrayWith(raw, SKEYS.md, SKEYS.deadline) || []).map(toEntry);
  return [...single, ...list]
    .filter((g) => g.deadline && new Date(g.deadline).getTime() > now)
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))[0] || null;
}

async function loadExtras() {
  const safe = (p) => p.catch(() => null);
  return { nextDeadline: await safe(loadDeadline()) };
}

const extrasOf = (m) => ({ worldRank: m.worldRank ?? null, transfers: m.transfers ?? null, chips: m.chips || null, trend: m.trend || null, playerIds: m.playerIds || [] });

// With only the league URL: official table plus the latest matchday, built from each
// member's top performer, captain and starting player IDs.
function leagueOnly(leagueName, members, latestMd, savedMds = {}) {
  const md = latestMd || 1;
  // Each matchday: saved results from earlier syncs, with the current feed covering the latest one
  const byMd = { ...savedMds, [md]: { members: members.map(mdRecord) } };
  const mds = Object.keys(byMd).map(Number).filter(Boolean).sort((a, b) => a - b);
  const historyFor = (teamId) => mds.map((d) => {
    const recs = byMd[d].members || [];
    const rec = recs.find((x) => x.teamId === teamId);
    if (!rec) return null;
    const performers = new Map();
    recs.forEach((x) => { if (x.topPerformer?.name) performers.set(x.topPerformer.id, x.topPerformer); });
    return {
      md: d, partial: true,
      points: rec.mdPoints ?? 0,
      players: [...performers.values()].filter((p) => (rec.playerIds || []).includes(p.id) || rec.topPerformer?.id === p.id)
        // Their own top performer first, so ties go to the game's pick
        .sort((a, b) => (b.id === rec.topPerformer?.id) - (a.id === rec.topPerformer?.id))
        .map((p) => ({ name: p.name, club: '', points: p.points, captain: p.id === rec.captainId, bench: false })),
    };
  }).filter(Boolean);
  const managers = members.map((m) => ({
    id: m.teamId, name: m.name, teamName: m.teamName, official: m.official, ...extrasOf(m), history: historyFor(m.teamId),
  }));
  return { mode: 'live', source: 'league-only', leagueName, updatedAt: new Date().toISOString(), matchdays: mds, managers };
}

async function loadLive() {
  let snap = null;
  if (storeEnabled()) {
    snap = await getSnapshot('league');
    if (!snap) {
      return { ...loadDemo(), notice: 'Waiting for the first sync. Open the Sync page (/sync.html) to load your league.' };
    }
  }
  const { leagueName, members, latestMd } = await getMembers(snap?.raw);
  const savedMds = snap ? ((await getSnapshot('history').catch(() => null))?.mds || {}) : {};
  const stamp = snap ? { updatedAt: snap.syncedAt, source: 'sync' } : {};
  const extras = await loadExtras();
  if (!TEAM_URL || snap) return { ...leagueOnly(leagueName, members, latestMd, savedMds), ...extras, ...stamp };
  const managers = await Promise.all(members.map(async (m) => {
    const mds = Array.from({ length: MAX_MD }, (_, i) => i + 1);
    const results = await Promise.all(mds.map(async (md) => {
      try { return { md, ...normalizeMatchday(await fetchRaw(m.teamId, md)) }; }
      catch { return null; }
    }));
    return { id: String(m.teamId), name: m.name, teamName: m.teamName || '', official: m.official, ...extrasOf(m), history: results.filter(Boolean) };
  }));
  // Keep only matchdays where someone actually scored.
  const played = new Set();
  managers.forEach((m) => m.history.forEach((h) => { if (h.points !== 0) played.add(h.md); }));
  managers.forEach((m) => { m.history = m.history.filter((h) => played.has(h.md)); });
  return {
    ...extras,
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
  const now = Date.now();
  const nextDeadline = { md: 7, deadline: new Date(now + ((2 * 24 + 5) * 60 + 12) * 60000).toISOString(), kickoff: new Date(now + ((2 * 24 + 5) * 60 + 12) * 60000).toISOString() };
  return { mode: 'demo', leagueName: 'Demo league', updatedAt: new Date().toISOString(), matchdays, managers, nextDeadline };
}

module.exports = { mapMembers, mdRecord, findMemberArray, findValue, loadDeadline, SCHEDULE_URL, withBuster, getJson, isDemo, loadLive, loadDemo, fetchRaw, fetchLeagueRaw, buildUrl, config, LEAGUE_URL };
