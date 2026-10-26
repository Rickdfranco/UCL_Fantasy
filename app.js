(() => {
  const state = { data: null, tab: 'table', md: null };
  const $ = (s) => document.querySelector(s);
  const view = $('#view');
  const LINE_COLORS = ['#2F7A4B', '#D7263D', '#3B6FE0', '#E39A12', '#8A4FD8', '#1C9AA6'];

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  // ---------- Stats helpers ----------
  const entry = (m, md) => m.history.find((h) => h.md === md);
  const mdPts = (m, md) => entry(m, md)?.points ?? 0;
  const totalTo = (m, md) => m.history.filter((h) => h.md <= md).reduce((s, h) => s + h.points, 0);

  // The game's own league table is used for the latest matchday when available,
  // since it includes anything matchday data can miss (like transfer penalties).
  function usesOfficial(md) {
    const { managers, matchdays } = state.data;
    return md === matchdays[matchdays.length - 1] && managers.every((m) => m.official && m.official.total != null);
  }

  function ranking(md) {
    const official = usesOfficial(md);
    const rows = state.data.managers.map((m) => ({ m, total: official ? m.official.total : totalTo(m, md), today: mdPts(m, md) }));
    if (official && rows.every((r) => r.m.official.rank != null)) {
      rows.forEach((r) => { r.rank = r.m.official.rank; });
      return rows.sort((a, b) => a.rank - b.rank);
    }
    rows.sort((a, b) => b.total - a.total || b.today - a.today);
    let lastTotal = null, lastRank = 0;
    rows.forEach((r, i) => { r.rank = r.total === lastTotal ? lastRank : i + 1; lastTotal = r.total; lastRank = r.rank; });
    return rows;
  }

  function prevMd(md) {
    const list = state.data.matchdays; const i = list.indexOf(md);
    return i > 0 ? list[i - 1] : null;
  }

  function starters(e) { return (e?.players || []).filter((p) => !p.bench); }

  function bestPlayer(md) {
    let best = null;
    const owners = new Map();
    state.data.managers.forEach((m) => {
      starters(entry(m, md)).forEach((p) => {
        const key = `${p.name}|${p.club}`;
        if (!owners.has(key)) owners.set(key, { ...p, owners: [] });
        owners.get(key).owners.push(m.name + (p.captain ? ' (captain)' : ''));
      });
    });
    owners.forEach((p) => { if (!best || p.points > best.points) best = p; });
    return best;
  }

  // ---------- Rendering ----------
  function renderPicker() {
    const picker = $('#md-picker');
    picker.hidden = state.tab === 'season' || !state.data?.matchdays.length;
    picker.innerHTML = state.data.matchdays.map((md) =>
      `<button class="md-chip" data-md="${md}" aria-pressed="${md === state.md}">MD ${md}</button>`).join('');
    picker.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  function renderTable() {
    const md = state.md; const before = prevMd(md);
    const prevRanks = before ? new Map(ranking(before).map((r) => [r.m.id, r.rank])) : null;
    const rows = ranking(md);
    const lastRank = rows[rows.length - 1].rank;
    view.innerHTML = `
      <h2>Standings after matchday ${md}</h2>
      ${usesOfficial(md) ? '<p class="note">Official league table from the game</p>' : ''}
      <table class="standings">
        <thead><tr><th>#</th><th>Manager</th><th class="num">MD ${md}</th><th class="num">Total</th></tr></thead>
        <tbody>${rows.map((r) => {
          let move = '<span class="move same">–</span>';
          if (prevRanks) {
            const d = prevRanks.get(r.m.id) - r.rank;
            if (d > 0) move = `<span class="move up" aria-label="up ${d}">▲${d}</span>`;
            if (d < 0) move = `<span class="move down" aria-label="down ${-d}">▼${-d}</span>`;
          }
          const spoon = r.rank === lastRank && rows.length > 2 ? '<span class="spoon" title="Bottom of the table"></span>' : '';
          return `<tr class="${r.rank === 1 ? 'leader' : ''}">
            <td class="pos">${r.rank}<br>${move}</td>
            <td class="who"><strong>${esc(r.m.name)}${spoon}</strong><span>${esc(r.m.teamName)}</span></td>
            <td class="num">${r.today}</td>
            <td class="num total">${r.total}</td></tr>`;
        }).join('')}</tbody>
      </table>`;
  }

  function renderMatchday() {
    const md = state.md;
    const best = bestPlayer(md);
    const day = state.data.managers.map((m) => ({ m, e: entry(m, md) })).sort((a, b) => (b.e?.points ?? 0) - (a.e?.points ?? 0));
    const top = day[0];
    const tied = day.filter((d) => (d.e?.points ?? 0) === (top.e?.points ?? 0)).map((d) => d.m.name);

    const sticker = best ? `
      <div class="sticker-wrap"><div class="sticker stick">
        <div class="sticker-inner">
          <div class="label">Best player, matchday ${md}</div>
          <div class="pts">${best.points}<small>pts</small></div>
          <div class="pname">${esc(best.name)}</div>
          ${best.club ? `<span class="club">${esc(best.club)}</span>` : ''}
          <div class="owners">Picked by ${esc(best.owners.join(', '))}</div>
        </div></div></div>` : '';

    view.innerHTML = `
      <h2>Player of the day</h2>${sticker || '<p class="empty">No player data for this matchday yet.</p>'}
      <h2>Won the day</h2>
      <div class="winner"><strong>${esc(tied.join(' and '))}</strong><span class="big">${top.e?.points ?? 0}</span></div>
      <h2>Everyone’s matchday</h2>
      <ul class="mgr-list">${day.map(({ m, e }) => {
        const xi = starters(e);
        const mvp = xi.slice().sort((a, b) => b.points - a.points)[0];
        const cap = xi.find((p) => p.captain);
        const benchPts = (e?.players || []).filter((p) => p.bench).reduce((s, p) => s + p.points, 0);
        const squad = (e?.players || []).slice().sort((a, b) => (a.bench - b.bench) || (b.points - a.points));
        return `<li class="mgr">
          <div class="mgr-head"><strong>${esc(m.name)}</strong><span class="big">${e?.points ?? 0}</span></div>
          <dl class="facts">
            ${mvp ? `<dt>Top scorer</dt><dd>${esc(mvp.name)}, ${mvp.points}</dd>` : ''}
            ${cap ? `<dt>Captain</dt><dd>${esc(cap.name)}, ${cap.points} × 2 = ${cap.points * 2}</dd>` : ''}
            ${e?.players?.some((p) => p.bench) ? `<dt>Left on bench</dt><dd>${plural(benchPts, 'pt')}</dd>` : ''}
          </dl>
          ${squad.length ? `<details class="squad"><summary>Show full squad</summary><ul class="squad-list">${squad.map((p) =>
            `<li class="${p.bench ? 'bench' : ''}"><span>${esc(p.name)}${p.captain ? '<span class="cap" title="Captain">C</span>' : ''}</span><span>${p.points}</span></li>`).join('')}</ul></details>` : ''}
        </li>`;
      }).join('')}</ul>`;
  }

  function renderSeason() {
    const { managers, matchdays } = state.data;
    // Chart: points behind the leader after each matchday (0 = top of the table)
    const W = 360, H = 220, P = { l: 34, r: 22, t: 12, b: 24 };
    const leaderAt = matchdays.map((md) => Math.max(...managers.map((m) => totalTo(m, md))));
    const series = managers.map((m) => matchdays.map((md, i) => totalTo(m, md) - leaderAt[i]));
    const minY = Math.min(-10, ...series.flat());
    const x = (i) => P.l + (matchdays.length === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (matchdays.length - 1));
    const y = (v) => P.t + (v / minY) * (H - P.t - P.b);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(minY * f));
    const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Points behind the leader after each matchday">
      ${ticks.map((t) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)" stroke-width="1"/>
        <text x="${P.l - 6}" y="${y(t) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${t}</text>`).join('')}
      ${matchdays.map((md, i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">MD ${md}</text>`).join('')}
      ${series.map((s, k) => `<polyline fill="none" stroke="${LINE_COLORS[k % LINE_COLORS.length]}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"
        points="${s.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>
        ${s.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${LINE_COLORS[k % LINE_COLORS.length]}"><title>${esc(managers[k].name)}, MD ${matchdays[i]}: ${v === 0 ? 'leading' : `${-v} behind`}</title></circle>`).join('')}`).join('')}
    </svg>`;

    // Awards
    const wins = new Map(managers.map((m) => [m.name, 0]));
    let bestDay = null, benchRegret = new Map(managers.map((m) => [m.name, 0]));
    const playerTotals = new Map();
    matchdays.forEach((md) => {
      const pts = managers.map((m) => mdPts(m, md)); const hi = Math.max(...pts);
      managers.forEach((m, i) => {
        if (pts[i] === hi) wins.set(m.name, wins.get(m.name) + 1);
        if (!bestDay || pts[i] > bestDay.pts) bestDay = { name: m.name, pts: pts[i], md };
        const e = entry(m, md);
        (e?.players || []).forEach((p) => {
          if (p.bench) benchRegret.set(m.name, benchRegret.get(m.name) + p.points);
          const key = `${p.name}|${p.club}`;
          const rec = playerTotals.get(key) || { name: p.name, club: p.club, byMd: new Map() };
          rec.byMd.set(md, p.points); playerTotals.set(key, rec);
        });
      });
    });
    const topWins = [...wins].sort((a, b) => b[1] - a[1])[0];
    const topBench = [...benchRegret].sort((a, b) => b[1] - a[1])[0];
    const topPlayer = [...playerTotals.values()].map((p) => ({ ...p, total: [...p.byMd.values()].reduce((s, v) => s + v, 0) }))
      .sort((a, b) => b.total - a.total)[0];

    view.innerHTML = `
      <h2>Points behind the leader</h2>
      <div class="chart-box">${svg}
        <div class="legend">${managers.map((m, k) => `<span style="--c:${LINE_COLORS[k % LINE_COLORS.length]}">${esc(m.name)}</span>`).join('')}</div>
      </div>
      <h2>Season awards</h2>
      <div class="awards">
        <div class="award"><p class="what">Most matchday wins</p><p class="who">${esc(topWins[0])}</p><p class="detail">${plural(topWins[1], 'win')}</p></div>
        <div class="award"><p class="what">Best single matchday</p><p class="who">${esc(bestDay.name)}</p><p class="detail">${bestDay.pts} pts on matchday ${bestDay.md}</p></div>
        ${topPlayer ? `<div class="award"><p class="what">Top player owned by the group</p><p class="who">${esc(topPlayer.name)}</p><p class="detail">${topPlayer.total} pts in matchdays someone owned him</p></div>` : ''}
        ${topBench && topBench[1] > 0 ? `<div class="award"><p class="what">Most points left on the bench</p><p class="who">${esc(topBench[0])}</p><p class="detail">${plural(topBench[1], 'pt')} wasted</p></div>` : ''}
      </div>`;
  }

  function render() {
    if (!state.data) return;
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
    renderPicker();
    if (!state.data.matchdays.length) {
      view.innerHTML = '<div class="empty"><p>No matchdays have been played yet. Scores show up here after the first round of games.</p></div>';
      return;
    }
    ({ table: renderTable, matchday: renderMatchday, season: renderSeason })[state.tab]();
  }

  // ---------- Data ----------
  async function load() {
    const btn = $('#refresh'); btn.classList.add('spin');
    try {
      const res = await fetch('/api/league', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error);
      state.data = data;
      if (!data.matchdays.includes(state.md)) state.md = data.matchdays[data.matchdays.length - 1] ?? null;
      $('#league-name').textContent = data.leagueName;
      document.title = data.leagueName;
      $('#updated').textContent = `Updated ${new Date(data.updatedAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;
      const banner = $('#banner');
      banner.hidden = data.mode !== 'demo';
      banner.textContent = 'You’re looking at demo data. Add your team IDs and data URL to see your real group (see the README).';
      render();
    } catch (err) {
      if (!state.data) {
        view.innerHTML = `<div class="empty"><p>Scores couldn’t be loaded: ${esc(err.message)}</p><button id="retry">Try again</button></div>`;
        $('#retry').onclick = load;
      }
      $('#updated').textContent = 'Offline, showing last saved scores';
    } finally { btn.classList.remove('spin'); }
  }

  // ---------- Events ----------
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]'); if (!b) return;
    state.tab = b.dataset.tab; render();
  });
  $('#md-picker').addEventListener('click', (e) => {
    const b = e.target.closest('[data-md]'); if (!b) return;
    state.md = Number(b.dataset.md); render();
  });
  $('#refresh').addEventListener('click', load);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  load();
})();
