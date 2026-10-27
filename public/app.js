(() => {
  const state = { data: null, tab: 'table', md: null, rivalA: null, rivalB: null };
  const $ = (s) => document.querySelector(s);
  const view = $('#view');
  const LINE_COLORS = ['#E6D3AE', '#3D6BF2', '#C3C8D1', '#E0877C', '#8FBF98', '#B58BE8'];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const DISPLAY_TZ = 'America/Los_Angeles'; // all times shown in Pacific (PST/PDT)

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
  // Every matchday of the season: played ones with data, missing past ones, and upcoming ones
  const latestPlayed = () => state.data.matchdays[state.data.matchdays.length - 1] ?? 0;
  const totalMds = () => Math.max(state.data.totalMatchdays || 0, latestPlayed());
  const mdStatus = (md) => state.data.matchdays.includes(md) ? 'played' : md > latestPlayed() ? 'future' : 'missing';

  function renderPicker() {
    const picker = $('#md-picker');
    picker.hidden = state.tab === 'season' || !state.data?.matchdays.length;
    const all = Array.from({ length: totalMds() }, (_, i) => i + 1);
    picker.innerHTML = all.map((md) => {
      const st = mdStatus(md);
      const label = st === 'future' ? `Matchday ${md}, coming up` : st === 'missing' ? `Matchday ${md}, not synced` : `Matchday ${md}`;
      return `<button class="md-chip ${st}" data-md="${md}" aria-pressed="${md === state.md}" aria-label="${label}">MD ${md}</button>`;
    }).join('');
    const sel = picker.querySelector('[aria-pressed="true"]');
    if (sel) picker.scrollLeft = sel.offsetLeft - picker.clientWidth / 2 + sel.offsetWidth / 2;
  }

  function renderPlaceholder() {
    const md = state.md, st = mdStatus(md), nd = state.data.nextDeadline;
    if (st === 'future') {
      const isNext = nd?.md === md;
      const next = latestPlayed() + 1;
      view.innerHTML = `${isNext ? deadlineCard() : ''}
        <div class="placeholder">
          <p class="ph-kicker">Matchday ${md}</p>
          <h2 class="ph-title">Coming up</h2>
          <p class="ph-text">${isNext ? 'Get your transfers and captain sorted before the deadline. Scores land here once the matchday is played and synced.'
            : `This matchday hasn’t been played yet.${md > next ? ` Matchday ${next} is next.` : ''} Scores land here once it’s played and synced.`}</p>
        </div>`;
    } else {
      view.innerHTML = `
        <div class="placeholder">
          <p class="ph-kicker">Matchday ${md}</p>
          <h2 class="ph-title">Not synced yet</h2>
          <p class="ph-text">This matchday was played before the app started saving history, so its scores aren’t here yet. Everyone’s season totals already include it.</p>
          <a class="pill-btn" href="/sync.html">Add it on the Sync page</a>
        </div>`;
    }
  }

  function renderTable() {
    const md = state.md; const before = prevMd(md);
    const prevRanks = before ? new Map(ranking(before).map((r) => [r.m.id, r.rank])) : null;
    const rows = ranking(md);
    const lastRank = rows[rows.length - 1].rank;
    view.innerHTML = deadlineCard() + `
      <h2>Standings after matchday ${md}</h2>
      ${usesOfficial(md) ? '<p class="note">Official league table from the game</p>' : ''}
      <table class="standings">
        <thead><tr><th>#</th><th>Manager</th><th class="num">MD ${md}</th><th class="num">Total</th></tr></thead>
        <tbody>${rows.map((r) => {
          let move = '<span class="move same">–</span>';
          if (!prevRanks && r.m.trend === 'up') move = '<span class="move up" aria-label="moved up">▲</span>';
          if (!prevRanks && r.m.trend === 'down') move = '<span class="move down" aria-label="moved down">▼</span>';
          if (prevRanks) {
            const d = prevRanks.get(r.m.id) - r.rank;
            if (d > 0) move = `<span class="move up" aria-label="up ${d}">▲${d}</span>`;
            if (d < 0) move = `<span class="move down" aria-label="down ${-d}">▼${-d}</span>`;
          }
          const spoon = r.rank === lastRank && rows.length > 2 ? '<span class="spoon" title="Bottom of the table"></span>' : '';
          return `<tr class="${r.rank === 1 ? 'leader' : ''}">
            <td class="pos">${r.rank}<br>${move}</td>
            <td class="who"><strong>${nameBtn(r.m)}${spoon}</strong><span>${esc(r.m.teamName)}</span></td>
            <td class="num">${r.today}</td>
            <td class="num total" data-count="${r.total}">${r.total}</td></tr>`;
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
          <div class="pts"><span data-count="${best.points}">${best.points}</span><small>pts</small></div>
          <div class="pname">${esc(best.name)}</div>
          ${best.club ? `<span class="club">${esc(best.club)}</span>` : ''}
          <div class="owners">Picked by ${esc(best.owners.join(', '))}</div>
        </div></div></div>` : '';

    view.innerHTML = deadlineCard() + `
      <h2>Player of the day</h2>${sticker || '<p class="empty">No player data for this matchday yet.</p>'}
      <h2>Won the day</h2>
      <div class="winner"><strong>${esc(tied.join(' and '))}</strong><span class="big" data-count="${top.e?.points ?? 0}">${top.e?.points ?? 0}</span></div>
      <button class="pill-btn recap-btn" id="make-recap">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 15V3m0 0l-4 4m4-4l4 4M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Create recap image</button>
      <h2>Everyone’s matchday</h2>
      <ul class="mgr-list">${day.map(({ m, e }) => {
        const xi = starters(e);
        const mvp = xi.slice().sort((a, b) => b.points - a.points)[0];
        const cap = xi.find((p) => p.captain);
        const benchPts = (e?.players || []).filter((p) => p.bench).reduce((s, p) => s + p.points, 0);
        const squad = (e?.players || []).slice().sort((a, b) => (a.bench - b.bench) || (b.points - a.points));
        return `<li class="mgr">
          <div class="mgr-head"><strong>${nameBtn(m)}</strong><span class="big" data-count="${e?.points ?? 0}">${e?.points ?? 0}</span></div>
          <dl class="facts">
            ${mvp ? `<dt>Top scorer</dt><dd>${esc(mvp.name)}, ${mvp.points}</dd>` : ''}
            ${cap ? `<dt>Captain</dt><dd>${esc(cap.name)}, ${cap.points} × 2 = ${cap.points * 2}</dd>` : ''}
            ${e?.players?.some((p) => p.bench) ? `<dt>Left on bench</dt><dd>${plural(benchPts, 'pt')}</dd>` : ''}
          </dl>
          ${squad.length && !e?.partial ? `<details class="squad"><summary>Show full squad</summary><ul class="squad-list">${squad.map((p) =>
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
      ${series.map((s, k) => `<polyline class="chart-line" pathLength="1" style="--i:${k}" fill="none" stroke="${LINE_COLORS[k % LINE_COLORS.length]}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"
        points="${s.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>
        ${s.map((v, i) => `<circle class="chart-dot" style="--i:${k}" cx="${x(i)}" cy="${y(v)}" r="3" fill="${LINE_COLORS[k % LINE_COLORS.length]}"><title>${esc(managers[k].name)}, MD ${matchdays[i]}: ${v === 0 ? 'leading' : `${-v} behind`}</title></circle>`).join('')}`).join('')}
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
        <div class="award"><p class="what">Biggest PP 🍆 - Most matchday wins</p><p class="who">${esc(topWins[0])}</p><p class="detail">${plural(topWins[1], 'win')}</p></div>
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
    if (state.tab !== 'season' && mdStatus(state.md) !== 'played') renderPlaceholder();
    else ({ table: renderTable, matchday: renderMatchday, season: renderSeason, rivals: renderRivals })[state.tab]();
    animateIn();
    tickCountdowns();
  }

  // ---------- Motion ----------
  function moveTabInk() {
    const active = document.querySelector('.tabs button[aria-selected="true"]');
    const ink = document.querySelector('.tab-ink');
    if (!active || !ink) return;
    const w = active.offsetWidth * 0.5;
    ink.style.width = `${w}px`;
    ink.style.transform = `translateX(${active.offsetLeft + (active.offsetWidth - w) / 2}px)`;
  }

  function countUp(el) {
    const target = Number(el.dataset.count);
    if (!Number.isFinite(target) || reduceMotion.matches || target === 0) { el.textContent = target; return; }
    const start = performance.now(), dur = 750;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      el.textContent = Math.round(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function animateIn() {
    moveTabInk();
    view.classList.remove('view-swap'); void view.offsetWidth; view.classList.add('view-swap');
    const items = view.querySelectorAll('.placeholder, h2, .note, .standings tbody tr, .winner, .recap-btn, .mgr, .chart-box, .award, .empty, .h2h-pick, .h2h-score, .h2h-gap, .wk, .fx, .countdown');
    items.forEach((el, i) => { el.classList.add('reveal'); el.style.setProperty('--i', Math.min(i, 12)); });
    view.querySelectorAll('[data-count]').forEach(countUp);
  }
  window.addEventListener('resize', moveTabInk);

  // ---------- Shared helpers for new features ----------
  const byId = (id) => state.data.managers.find((m) => m.id === id);
  const lastMd = () => state.data.matchdays[state.data.matchdays.length - 1];
  const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const avgOn = (md) => { const ms = state.data.managers; return ms.reduce((t, m) => t + mdPts(m, md), 0) / ms.length; };
  const nameBtn = (m) => `<button class="name-link" data-profile="${esc(m.id)}">${esc(m.name)}</button>`;

  function managerStats(m) {
    const { managers, matchdays } = state.data;
    let wins = 0, best = null, star = null, capPts = 0, benchPts = 0;
    matchdays.forEach((md) => {
      const p = mdPts(m, md);
      if (p === Math.max(...managers.map((o) => mdPts(o, md)))) wins++;
      if (!best || p > best.pts) best = { pts: p, md };
      const e = entry(m, md);
      starters(e).forEach((pl) => {
        if (!star || pl.points > star.points) star = { ...pl, md };
        if (pl.captain) capPts += pl.points * 2;
      });
      (e?.players || []).filter((pl) => pl.bench).forEach((pl) => { benchPts += pl.points; });
    });
    return { wins, best, star, capPts, benchPts };
  }

  // ---------- Sheet (profile and recap) ----------
  const sheet = $('#sheet');
  let lastFocus = null;
  function openSheet(html) {
    lastFocus = document.activeElement;
    $('#sheet-body').innerHTML = html;
    sheet.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('open')));
    sheet.querySelector('.sheet-close').focus();
    $('#sheet-body').querySelectorAll('[data-count]').forEach(countUp);
  }
  function closeSheet() {
    sheet.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(() => { sheet.hidden = true; $('#sheet-body').innerHTML = ''; }, reduceMotion.matches ? 0 : 320);
    lastFocus?.focus?.();
  }
  sheet.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });

  // ---------- Profile ----------
  function openProfile(id) {
    const m = byId(id); if (!m) return;
    const { matchdays, managers } = state.data;
    const row = ranking(lastMd()).find((r) => r.m.id === id);
    const st = managerStats(m);
    const form = matchdays.slice(-5).map((md) => {
      const above = mdPts(m, md) >= avgOn(md);
      return `<span class="dot ${above ? 'above' : 'below'}" title="MD ${md}: ${mdPts(m, md)} pts, group average ${Math.round(avgOn(md))}"></span>`;
    }).join('');
    const W = 340, H = 130, P = { l: 6, r: 6, t: 18, b: 22 };
    const max = Math.max(1, ...matchdays.map((md) => mdPts(m, md)));
    const bw = (W - P.l - P.r) / matchdays.length;
    const bars = matchdays.map((md, i) => {
      const v = mdPts(m, md), h = Math.max(2, (v / max) * (H - P.t - P.b));
      const x = P.l + i * bw + bw * 0.18, w = bw * 0.64, y = H - P.b - h;
      const isBest = st.best && md === st.best.md;
      return `<rect class="bar" style="--i:${i}" x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${isBest ? '#3D6BF2' : '#E6D3AE'}" opacity="${isBest ? 1 : 0.85}"><title>MD ${md}: ${v} pts</title></rect>
        <text x="${x + w / 2}" y="${y - 5}" text-anchor="middle" font-size="10" fill="var(--silver)">${v}</text>
        <text x="${x + w / 2}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${md}</text>`;
    }).join('');
    openSheet(`
      <p class="sheet-sub">${ordinal(row.rank)} of ${managers.length}, ${row.total} pts</p>
      ${(() => { const g = grudgeTable(lastMd()).find((r) => r.id === id); return managers.length > 1 && g ? `<p class="sheet-sub">Grudge league: ${ordinal(g.rank)}, won ${g.w}, drew ${g.d}, lost ${g.l}</p>` : ''; })()}
      <h2 id="sheet-title" class="sheet-title">${esc(m.name)}</h2>
      ${m.teamName ? `<p class="sheet-team">${esc(m.teamName)}</p>` : ''}
      ${(() => {
        const bits = [];
        if (m.worldRank) bits.push(`<span class="chip-stat"><b>${m.worldRank.toLocaleString()}</b> worldwide</span>`);
        if (m.chips?.wildcard) bits.push(`<span class="chip-stat">Wildcard used MD ${m.chips.wildcard}</span>`);
        if (m.chips?.limitless) bits.push(`<span class="chip-stat">Limitless used MD ${m.chips.limitless}</span>`);
        return bits.length ? `<p class="chip-row">${bits.join('')}</p>` : '';
      })()}
      <div class="cabinet">
        <div class="award"><p class="what">Matchday wins</p><p class="who" data-count="${st.wins}">${st.wins}</p></div>
        <div class="award"><p class="what">Best matchday</p><p class="who">${st.best ? st.best.pts : 0}</p><p class="detail">${st.best ? `Matchday ${st.best.md}` : ''}</p></div>
        <div class="award"><p class="what">Best player owned</p><p class="who small">${st.star ? esc(st.star.name) : 'None yet'}</p><p class="detail">${st.star ? `${st.star.points} pts on matchday ${st.star.md}` : ''}</p></div>
        <div class="award"><p class="what">Captain points</p><p class="who" data-count="${st.capPts}">${st.capPts}</p>${m.history.some((h) => h.players?.some((pl) => pl.bench)) ? `<p class="detail">${plural(st.benchPts, 'pt')} left on the bench</p>` : ''}</div>
      </div>
      <h3 class="sheet-h">Form</h3>
      <p class="form-row">${form}<span class="form-key">Filled means above the group average, ${Math.min(5, matchdays.length) === 1 ? 'latest matchday' : `last ${Math.min(5, matchdays.length)} matchdays`}</span></p>
      <h3 class="sheet-h">Points by matchday</h3>
      <div class="chart-box"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Points by matchday for ${esc(m.name)}">${bars}</svg></div>
      ${managers.length > 1 ? `<button class="pill-btn" data-compare="${esc(m.id)}">Compare head-to-head</button>` : ''}`);
  }

  // ---------- Grudge matches (weekly head-to-head fixtures) ----------
  const GHOST = '__avg__';
  function grudgeRounds() {
    const ids = state.data.managers.map((m) => m.id).sort();
    if (ids.length % 2) ids.push(GHOST);
    const n = ids.length, out = [];
    let arr = ids.slice();
    for (let r = 0; r < n - 1; r++) {
      const pairs = [];
      for (let i = 0; i < n / 2; i++) pairs.push([arr[i], arr[n - 1 - i]]);
      out.push(pairs);
      arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
    }
    return out;
  }
  const grudgeFixtures = (md) => { const R = grudgeRounds(); return R[(md - 1) % R.length]; };
  const gScore = (id, md) => (id === GHOST ? Math.round(avgOn(md)) : mdPts(byId(id), md));
  const gName = (id) => (id === GHOST ? 'Group average' : byId(id).name);
  const gNameBtn = (id) => (id === GHOST ? '<span class="ghost">Group average</span>' : nameBtn(byId(id)));

  function grudgeTable(upto) {
    const rows = new Map(state.data.managers.map((m) => [m.id, { id: m.id, w: 0, d: 0, l: 0, pts: 0, pf: 0 }]));
    state.data.matchdays.filter((md) => md <= upto).forEach((md) => {
      grudgeFixtures(md).forEach(([a, b]) => {
        const sa = gScore(a, md), sb = gScore(b, md);
        [[a, sa, sb], [b, sb, sa]].forEach(([id, mine, theirs]) => {
          const r = rows.get(id); if (!r) return;
          r.pf += mine;
          if (mine > theirs) { r.w++; r.pts += 3; } else if (mine === theirs) { r.d++; r.pts += 1; } else r.l++;
        });
      });
    });
    const list = [...rows.values()].sort((x, y) => y.pts - x.pts || y.pf - x.pf);
    let prev = null;
    list.forEach((r, i) => { r.rank = prev && prev.pts === r.pts && prev.pf === r.pf ? prev.rank : i + 1; prev = r; });
    return list;
  }

  function lastMeeting(a, b, before) {
    const mds = state.data.matchdays.filter((md) => md < before).reverse();
    for (const md of mds) {
      const hit = grudgeFixtures(md).find(([x, y]) => (x === a && y === b) || (x === b && y === a));
      if (hit) {
        const sa = gScore(a, md), sb = gScore(b, md);
        if (sa === sb) return `Last meeting, MD ${md}: drew ${sa} each`;
        return `Last meeting, MD ${md}: ${esc(gName(sa > sb ? a : b))} won ${Math.max(sa, sb)} to ${Math.min(sa, sb)}`;
      }
    }
    return 'First meeting';
  }

  function grudgeSection() {
    const md = state.md;
    const fx = grudgeFixtures(md).map(([a, b]) => ({ a, b, sa: gScore(a, md), sb: gScore(b, md) }));
    const closest = fx.length > 1 ? fx.reduce((c, f) => (Math.abs(f.sa - f.sb) < Math.abs(c.sa - c.sb) ? f : c)) : null;
    const table = grudgeTable(md);
    const next = md === lastMd() ? md + 1 : null;
    const rankOf = new Map(table.map((r) => [r.id, r.rank]));
    const pos = (id) => (id === GHOST ? '' : `<span class="fx-pos">${ordinal(rankOf.get(id))}</span>`);
    return `
      <h2>Grudge matches, matchday ${md}</h2>
      <ul class="fixtures">${fx.map((f) => {
        const margin = Math.abs(f.sa - f.sb);
        const note = margin === 0 ? 'Honours even' : `${esc(gName(f.sa > f.sb ? f.a : f.b))} won by ${plural(margin, 'pt')}`;
        return `<li class="fx${f === closest ? ' closest' : ''}">
          ${f === closest ? '<span class="fx-tag">Closest grudge</span>' : ''}
          <div class="fx-row">
            <div class="fx-side ${f.sa > f.sb ? 'win' : ''}">${gNameBtn(f.a)}</div>
            <div class="fx-score"><span data-count="${f.sa}">${f.sa}</span><span class="fx-dash"></span><span data-count="${f.sb}">${f.sb}</span></div>
            <div class="fx-side right ${f.sb > f.sa ? 'win' : ''}">${gNameBtn(f.b)}</div>
          </div>
          <p class="fx-note">${note}</p>
        </li>`;
      }).join('')}</ul>
      <h2>Grudge league after matchday ${md}</h2>
      <table class="standings grudge">
        <thead><tr><th>#</th><th>Manager</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">Pts</th></tr></thead>
        <tbody>${table.map((r) => `<tr class="${r.rank === 1 ? 'leader' : ''}">
          <td class="pos">${r.rank}</td>
          <td class="who"><strong>${nameBtn(byId(r.id))}</strong><span>${r.pf} pts scored</span></td>
          <td class="num">${r.w}</td><td class="num">${r.d}</td><td class="num">${r.l}</td>
          <td class="num total" data-count="${r.pts}">${r.pts}</td></tr>`).join('')}</tbody>
      </table>
      ${next ? `<h2>Next up, matchday ${next}</h2>
        <ul class="fixtures">${grudgeFixtures(next).map(([a, b]) => `<li class="fx upcoming">
          <div class="fx-row">
            <div class="fx-side">${gNameBtn(a)}${pos(a)}</div>
            <div class="fx-score"><span class="fx-vs">vs</span></div>
            <div class="fx-side right">${gNameBtn(b)}${pos(b)}</div>
          </div>
          <p class="fx-note">${lastMeeting(a, b, next)}</p>
        </li>`).join('')}</ul>` : ''}`;
  }

  // ---------- Rivals (head-to-head) ----------
  function renderRivals() {
    const { managers, matchdays } = state.data;
    if (managers.length < 2) { view.innerHTML = '<div class="empty"><p>Head-to-head needs at least two managers.</p></div>'; return; }
    const order = ranking(lastMd());
    if (!byId(state.rivalA)) state.rivalA = order[0].m.id;
    if (!byId(state.rivalB) || state.rivalB === state.rivalA) state.rivalB = order.find((r) => r.m.id !== state.rivalA).m.id;
    const A = byId(state.rivalA), B = byId(state.rivalB);
    const totA = order.find((r) => r.m.id === A.id).total, totB = order.find((r) => r.m.id === B.id).total;
    let wa = 0, wb = 0, dr = 0;
    const max = Math.max(1, ...matchdays.flatMap((md) => [mdPts(A, md), mdPts(B, md)]));
    const weeks = matchdays.map((md) => {
      const a = mdPts(A, md), b = mdPts(B, md);
      if (a > b) wa++; else if (b > a) wb++; else dr++;
      return `<li class="wk">
        <span class="wk-a ${a >= b ? 'win' : ''}"><span class="wk-n">${a}</span><span class="wk-bar" style="--w:${(a / max) * 100}%"></span></span>
        <span class="wk-md">MD ${md}</span>
        <span class="wk-b ${b >= a ? 'win' : ''}"><span class="wk-bar" style="--w:${(b / max) * 100}%"></span><span class="wk-n">${b}</span></span>
      </li>`;
    }).join('');
    const md = state.md;
    const sa = new Map(starters(entry(A, md)).map((p) => [`${p.name}|${p.club}`, p]));
    const sb = new Map(starters(entry(B, md)).map((p) => [`${p.name}|${p.club}`, p]));
    const both = [...sa.keys()].filter((k) => sb.has(k)).map((k) => sa.get(k)).sort((x, y) => y.points - x.points);
    const onlyA = [...sa.keys()].filter((k) => !sb.has(k)).map((k) => sa.get(k)).sort((x, y) => y.points - x.points);
    const onlyB = [...sb.keys()].filter((k) => !sa.has(k)).map((k) => sb.get(k)).sort((x, y) => y.points - x.points);
    const list = (arr) => arr.length ? `<ul class="plist">${arr.map((p) => `<li><span>${esc(p.name)}</span><span>${p.points}</span></li>`).join('')}</ul>` : '<p class="muted-s">None</p>';
    const sumPts = (arr) => arr.reduce((t, p) => t + p.points, 0);
    const opts = (sel) => managers.map((m) => `<option value="${esc(m.id)}" ${m.id === sel ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
    const gap = totA - totB;

    view.innerHTML = grudgeSection() + `
      <h2>Head-to-head</h2>
      <div class="h2h-pick">
        <label class="sel"><span class="sr">First manager</span><select id="rival-a">${opts(A.id)}</select></label>
        <span class="vs">vs</span>
        <label class="sel"><span class="sr">Second manager</span><select id="rival-b">${opts(B.id)}</select></label>
      </div>
      <div class="h2h-score">
        <div class="side"><span class="score" data-count="${wa}">${wa}</span>${nameBtn(A)}</div>
        <div class="mid">Matchday wins${dr ? `<br>${plural(dr, 'draw')}` : ''}</div>
        <div class="side right"><span class="score" data-count="${wb}">${wb}</span>${nameBtn(B)}</div>
      </div>
      <p class="h2h-gap">${gap === 0 ? `Level on ${totA} season points` : `${esc(gap > 0 ? A.name : B.name)} leads by ${plural(Math.abs(gap), 'pt')} on the season, ${Math.max(totA, totB)} to ${Math.min(totA, totB)}`}</p>
      <h2>Week by week</h2>
      <ul class="weeks">${weeks}</ul>
      <h2>Squads on matchday ${md}</h2>
      <div class="squads3">
        <div class="award"><p class="what">Only ${esc(A.name)}</p><p class="detail">${plural(sumPts(onlyA), 'pt')} from these</p>${list(onlyA)}</div>
        <div class="award"><p class="what">Only ${esc(B.name)}</p><p class="detail">${plural(sumPts(onlyB), 'pt')} from these</p>${list(onlyB)}</div>
        <div class="award"><p class="what">Both own</p><p class="detail">${plural(both.length, 'player')}</p>${list(both)}</div>
      </div>`;
  }

  // ---------- Recap image ----------
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }
  function fit(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text; while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }

  async function buildRecap(md) {
    const SERIF = 'Geist, "SF Pro Display", -apple-system, "Segoe UI", Roboto, sans-serif';
    const SANS = SERIF;
    try { await Promise.all([document.fonts.load('600 80px Geist'), document.fonts.load('500 30px Geist')]); } catch {}
    const W = 1080, H = 1350, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    if ('letterSpacing' in ctx) ctx.letterSpacing = '-1px'; // tighter, tech-style tracking
    const CREAM = '#E6D3AE', INK = '#EDE4D3', SILVER = '#C3C8D1', MUTED = '#958D80';

    ctx.fillStyle = '#09090B'; ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W / 2, -80, 40, W / 2, -80, 900);
    glow.addColorStop(0, 'rgba(11,31,94,0.85)'); glow.addColorStop(1, 'rgba(11,31,94,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

    // Title
    ctx.fillStyle = INK; ctx.font = `600 64px ${SERIF}`; ctx.textBaseline = 'alphabetic';
    ctx.fillText(fit(ctx, state.data.leagueName, W - 160), 80, 140);
    ctx.fillStyle = SILVER; ctx.font = `500 32px ${SANS}`; ctx.fillText(`Matchday ${md} recap`, 80, 192);
    ctx.fillStyle = '#26262D'; ctx.fillRect(80, 232, W - 160, 2);

    // Winner of the day
    const day = state.data.managers.map((m) => ({ m, p: mdPts(m, md) })).sort((a, b) => b.p - a.p);
    const winners = day.filter((d) => d.p === day[0].p).map((d) => d.m.name).join(' and ');
    ctx.fillStyle = MUTED; ctx.font = `500 30px ${SANS}`; ctx.fillText('Won the day', 80, 300);
    ctx.fillStyle = CREAM; ctx.font = `600 72px ${SERIF}`; ctx.fillText(fit(ctx, winners, 640), 80, 380);
    ctx.textAlign = 'right'; ctx.font = `600 120px ${SERIF}`; ctx.fillText(String(day[0].p), W - 80, 385);
    ctx.fillStyle = SILVER; ctx.font = `600 28px ${SANS}`; ctx.fillText('pts', W - 80, 420);
    ctx.textAlign = 'left';

    // Player of the day card
    const best = bestPlayer(md);
    if (best) {
      ctx.save(); ctx.translate(80 + 460, 470 + 160); ctx.rotate(-0.03); ctx.translate(-460, -160);
      ctx.shadowColor = 'rgba(61,107,242,0.45)'; ctx.shadowBlur = 60; ctx.shadowOffsetY = 20;
      const foil = ctx.createLinearGradient(0, 0, 920, 320);
      ['#8E949E', '#E9ECF1', '#A9AFB9', '#F6F7F9', '#9AA0AA', '#DDE1E7'].forEach((col, i, a) => foil.addColorStop(i / (a.length - 1), col));
      ctx.fillStyle = foil; roundRect(ctx, 0, 0, 920, 320, 34); ctx.fill();
      ctx.shadowColor = 'transparent';
      const navy = ctx.createLinearGradient(0, 0, 600, 320);
      navy.addColorStop(0, '#10287A'); navy.addColorStop(0.5, '#0B1F5E'); navy.addColorStop(1, '#050C26');
      ctx.fillStyle = navy; roundRect(ctx, 6, 6, 908, 308, 30); ctx.fill();
      ctx.fillStyle = SILVER; ctx.font = `600 28px ${SANS}`; ctx.fillText('Player of the day', 50, 66);
      ctx.fillStyle = CREAM; ctx.font = `600 150px ${SERIF}`; ctx.fillText(String(best.points), 46, 210);
      const ptsW = ctx.measureText(String(best.points)).width;
      ctx.fillStyle = SILVER; ctx.font = `600 30px ${SANS}`; ctx.fillText('pts', 60 + ptsW, 208);
      ctx.fillStyle = '#F4EEE2'; ctx.font = `600 62px ${SERIF}`; ctx.fillText(fit(ctx, best.name, 440), 430, 160);
      if (best.club) { ctx.strokeStyle = SILVER; ctx.lineWidth = 2; ctx.font = `700 26px ${SANS}`;
        const cw = ctx.measureText(best.club).width + 28; roundRect(ctx, 430, 186, cw, 44, 6); ctx.stroke();
        ctx.fillStyle = SILVER; ctx.fillText(best.club, 444, 218); }
      ctx.fillStyle = '#D7DCE6'; ctx.font = `500 26px ${SANS}`;
      ctx.fillText(fit(ctx, `Picked by ${best.owners.join(', ')}`, 820), 50, 278);
      ctx.restore();
    }

    // Table
    const before = prevMd(md);
    const prev = before ? new Map(ranking(before).map((r) => [r.m.id, r.rank])) : null;
    const rows = ranking(md).slice(0, 6);
    const lastRank = ranking(md).slice(-1)[0].rank;
    let y = 950;
    ctx.fillStyle = INK; ctx.font = `500 40px ${SERIF}`; ctx.fillText('Standings', 80, y - 40);
    ctx.fillStyle = MUTED; ctx.font = `500 24px ${SANS}`; ctx.textAlign = 'right';
    ctx.fillText(`MD ${md}`, W - 260, y - 40); ctx.fillText('Total', W - 80, y - 40); ctx.textAlign = 'left';
    rows.forEach((r) => {
      if (r.rank === 1) { ctx.fillStyle = 'rgba(230,211,174,0.09)'; ctx.fillRect(80, y - 6, W - 160, 60); ctx.fillStyle = CREAM; ctx.fillRect(80, y - 6, 4, 60); }
      ctx.fillStyle = r.rank === 1 ? CREAM : INK; ctx.font = `600 40px ${SERIF}`; ctx.fillText(String(r.rank), 104, y + 38);
      ctx.fillStyle = INK; ctx.font = `600 32px ${SANS}`; ctx.fillText(fit(ctx, r.m.name, 440), 170, y + 36);
      const nameW = Math.min(440, ctx.measureText(r.m.name).width);
      if (prev) { const d = prev.get(r.m.id) - r.rank;
        if (d) { ctx.fillStyle = d > 0 ? '#8FBF98' : '#E0877C'; ctx.font = `700 22px ${SANS}`; ctx.fillText(`${d > 0 ? '▲' : '▼'}${Math.abs(d)}`, 186 + nameW, y + 34); } }
      if (r.rank === lastRank && ranking(md).length > 2) { ctx.fillStyle = '#E0877C'; roundRect(ctx, 236 + nameW, y + 14, 14, 20, 2); ctx.fill(); }
      ctx.textAlign = 'right';
      ctx.fillStyle = SILVER; ctx.font = `500 32px ${SANS}`; ctx.fillText(String(r.today), W - 260, y + 36);
      ctx.fillStyle = r.rank === 1 ? CREAM : INK; ctx.font = `600 44px ${SERIF}`; ctx.fillText(String(r.total), W - 80, y + 38);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#26262D'; ctx.fillRect(80, y + 56, W - 160, 1);
      y += 62;
    });
    return c;
  }

  async function openRecap() {
    const md = state.md;
    openSheet(`<h2 id="sheet-title" class="sheet-title">Matchday ${md} recap</h2><p class="sheet-team">Creating your image…</p>`);
    const canvas = await buildRecap(md);
    const url = canvas.toDataURL('image/png');
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    const file = blob && new File([blob], `matchday-${md}-recap.png`, { type: 'image/png' });
    const canShare = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));
    $('#sheet-body').innerHTML = `
      <h2 id="sheet-title" class="sheet-title">Matchday ${md} recap</h2>
      <img class="recap-img" src="${url}" alt="Recap image for matchday ${md}: winner, player of the day and standings">
      <div class="recap-actions">
        ${canShare ? '<button class="pill-btn solid" id="recap-share">Share to group chat</button>' : ''}
        <a class="pill-btn" id="recap-save" href="${url}" download="matchday-${md}-recap.png">Save image</a>
      </div>
      <p class="muted-s">If saving doesn’t start, press and hold the image to save it.</p>`;
    $('#recap-share')?.addEventListener('click', async () => {
      try { await navigator.share({ files: [file], title: `${state.data.leagueName}, matchday ${md}` }); } catch {}
    });
  }

  // ---------- Countdown ----------
  function fmtCountdown(ms) {
    if (ms <= 0) return null;
    const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const p = (n) => String(n).padStart(2, '0');
    return d > 0 ? `${d}d ${p(h)}h ${p(m)}m ${p(sec)}s` : `${p(h)}h ${p(m)}m ${p(sec)}s`;
  }
  function fmtShort(ms) {
    const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
  const whenLabel = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: DISPLAY_TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

  function deadlineCard() {
    const nd = state.data?.nextDeadline;
    if (!nd?.deadline) return '';
    const sameTime = nd.kickoff && Math.abs(new Date(nd.kickoff) - new Date(nd.deadline)) < 60000;
    return `<section class="countdown" aria-label="Next deadline">
      <div class="cd-head"><span>${nd.md ? `Matchday ${nd.md} team deadline` : 'Next team deadline'}</span><span class="cd-when">${whenLabel(nd.deadline)}</span></div>
      <div class="cd-time" data-countdown="${nd.deadline}" aria-live="off">${fmtCountdown(new Date(nd.deadline) - Date.now()) || 'Teams are locked'}</div>
      ${nd.kickoff && !sameTime ? `<p class="cd-sub">First kickoff ${whenLabel(nd.kickoff)}</p>` : sameTime ? '<p class="cd-sub">Locks at the first kickoff</p>' : ''}
    </section>`;
  }
  function tickCountdowns() {
    document.querySelectorAll('[data-countdown]').forEach((el) => {
      el.textContent = fmtCountdown(new Date(el.dataset.countdown) - Date.now()) || 'Teams are locked';
    });
    const nd = state.data?.nextDeadline, mini = $('#deadline-mini');
    if (!mini) return;
    const left = nd?.deadline ? new Date(nd.deadline) - Date.now() : 0;
    mini.hidden = !(left > 0);
    if (left > 0) mini.textContent = `${nd.md ? `MD ${nd.md} deadline` : 'Deadline'} in ${fmtShort(left)}`;
    mini.classList.toggle('urgent', left > 0 && left < 3 * 3600 * 1000);
  }
  setInterval(tickCountdowns, 1000);

  // ---------- Pull to refresh ----------
  const ptr = document.createElement('div');
  ptr.className = 'ptr';
  ptr.setAttribute('aria-hidden', 'true');
  ptr.innerHTML = `<div class="ptr-inner">
      <svg class="ptr-ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="14" class="ptr-track"/><circle cx="18" cy="18" r="14" class="ptr-arc" pathLength="1"/>
        <path class="ptr-check" d="M12 18.5l4 4 8-9" pathLength="1"/></svg>
      <span class="ptr-label">Pull to refresh</span></div>`;
  document.querySelector('.top').after(ptr);
  const PULL_MAX = 130, PULL_TRIGGER = 72;
  let startY = null, pull = 0, refreshing = false;
  const movers = () => document.querySelectorAll('#banner, #view');
  function setPull(px, settle) {
    pull = px;
    ptr.classList.toggle('settle', !!settle);
    movers().forEach((el) => { el.classList.toggle('ptr-settle', !!settle); el.style.transform = px ? `translateY(${px}px)` : ''; });
    ptr.style.top = `${document.querySelector('.top').getBoundingClientRect().bottom}px`;
    ptr.style.height = `${px}px`;
    ptr.style.setProperty('--p', Math.min(1, px / PULL_TRIGGER));
    if (!refreshing) {
      ptr.classList.toggle('ready', px >= PULL_TRIGGER);
      ptr.querySelector('.ptr-label').textContent = px >= PULL_TRIGGER ? 'Release to refresh' : 'Pull to refresh';
    }
  }
  window.addEventListener('touchstart', (e) => {
    startY = (!refreshing && window.scrollY <= 0 && sheet.hidden && !e.target.closest('.md-picker, .pv-panel, select')) ? e.touches[0].clientY : null;
  }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (startY === null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0 || window.scrollY > 0) { if (pull) setPull(0); return; }
    if (e.cancelable) e.preventDefault();
    setPull(Math.min(PULL_MAX, dy * 0.5));
  }, { passive: false });
  window.addEventListener('touchend', async () => {
    if (startY === null) return;
    startY = null;
    if (pull < PULL_TRIGGER) { setPull(0, true); return; }
    refreshing = true;
    ptr.classList.add('spinning'); ptr.classList.remove('ready', 'done');
    ptr.querySelector('.ptr-label').textContent = 'Refreshing';
    setPull(64, true);
    const started = Date.now();
    await load();
    await new Promise((r) => setTimeout(r, Math.max(0, 700 - (Date.now() - started))));
    ptr.classList.remove('spinning'); ptr.classList.add('done');
    ptr.querySelector('.ptr-label').textContent = 'Up to date';
    await new Promise((r) => setTimeout(r, 650));
    refreshing = false;
    setPull(0, true);
    setTimeout(() => ptr.classList.remove('done'), 400);
  });

  // ---------- Data ----------
  async function load() {
    const btn = $('#refresh'); btn.classList.add('spin');
    try {
      const res = await fetch('/api/league', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error);
      state.data = data;
      if (!state.md || state.md > Math.max(data.totalMatchdays || 0, ...data.matchdays)) state.md = data.matchdays[data.matchdays.length - 1] ?? null;
      $('#league-name').textContent = data.leagueName;
      document.title = data.leagueName;
      $('#updated').textContent = `Updated ${new Date(data.updatedAt).toLocaleString('en-US', { timeZone: DISPLAY_TZ, weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}`;
      const banner = $('#banner');
      banner.hidden = data.mode !== 'demo';
      banner.textContent = data.notice || 'You’re looking at demo data. Add your team IDs and data URL to see your real group (see the README).';
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
  document.addEventListener('click', (e) => {
    const prof = e.target.closest('[data-profile]');
    if (prof) { openProfile(prof.dataset.profile); return; }
    const cmp = e.target.closest('[data-compare]');
    if (cmp) {
      const id = cmp.dataset.compare, order = ranking(lastMd());
      state.rivalA = id;
      state.rivalB = (order[0].m.id === id ? order[1] : order[0]).m.id;
      state.tab = 'rivals'; closeSheet(); render(); window.scrollTo({ top: 0 }); return;
    }
    if (e.target.closest('#make-recap')) openRecap();
  });
  view.addEventListener('change', (e) => {
    if (e.target.id === 'rival-a') state.rivalA = e.target.value;
    else if (e.target.id === 'rival-b') state.rivalB = e.target.value;
    else return;
    if (state.rivalA === state.rivalB) {
      const other = state.data.managers.find((m) => m.id !== state.rivalA).id;
      if (e.target.id === 'rival-a') state.rivalB = other; else state.rivalA = other;
    }
    render();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then((reg) => reg.update()).catch(() => {});
    // When a new version takes over, reload once so it shows immediately
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
  }
  load();
})();
