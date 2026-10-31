/* Rummikub UI: rendering, input, game loop, tutorial and self-updating PWA plumbing. */
(function () {
  'use strict';
  const SYMBOLS = ['●', '■', '▲', '◆'];
  const COLOR_NAMES = ['black', 'blue', 'red', 'orange'];
  const VERSION = self.APP_VERSION || 'dev';
  const KEYS = { game: 'rk-game', tut: 'rk-tutorial-seen', sort: 'rk-sort' };

  const $ = (sel) => document.querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  const ui = {
    screen: 'menu',        // 'menu' | 'game'
    selected: new Set(),
    humanTurn: false,
    turn: null,
    fresh: new Set(),      // tiles just played by someone (glow)
    drawn: null,           // tile the human just drew
    origins: new Map(),    // id -> {p:{x,y}, delay}: where a newly appeared tile flies in from
    thinking: -1,
    log: [],
    status: '',
    sort: store.get(KEYS.sort) || 'color',
    endTurn: null,
    token: 0,              // bumps when a game is abandoned so stale loops stop
  };
  let game = null;

  /* ------------------------------------------------------------------ tiles */
  function tileHtml(id, o) {
    o = o || {};
    const cls = ['tile'];
    let n; let s;
    if (RK.isJoker(id)) {
      cls.push('joker');
      n = '★';
      s = o.jokerValue ? '=' + o.jokerValue : 'joker';
    } else {
      cls.push('c' + RK.colorOf(id));
      n = RK.valueOf(id);
      s = SYMBOLS[RK.colorOf(id)];
    }
    if (o.sel) cls.push('sel');
    if (o.mine) cls.push('mine');
    if (o.fresh) cls.push('fresh');
    if (o.static) cls.push('static');
    const label = RK.isJoker(id) ? 'joker' : `${COLOR_NAMES[RK.colorOf(id)]} ${n}`;
    const tag = o.static ? 'div' : 'button';
    return `<${tag} class="${cls.join(' ')}" data-id="${id}" ${o.static ? '' : `data-tile="${id}"`} aria-label="${label}"><span class="n">${n}</span><span class="s">${s}</span></${tag}>`;
  }
  const mt = (c, v) => tileHtml(c * 13 + v - 1, { static: true });
  const mj = (val) => tileHtml(104, { static: true, jokerValue: val });

  /* ------------------------------------------------------------------ rendering */
  function sortedRack(ids) {
    const key = (id) => {
      if (RK.isJoker(id)) return 1000 + id;
      return ui.sort === 'color' ? RK.colorOf(id) * 100 + RK.valueOf(id) : RK.valueOf(id) * 10 + RK.colorOf(id);
    };
    return ids.slice().sort((a, b) => key(a) - key(b) || a - b);
  }

  function opponentsHtml() {
    return game.players.slice(1).map((p, k) => {
      const i = k + 1;
      const active = game.current === i && !game.over;
      const n = p.rack.length;
      return `<div class="opp ${active ? 'active' : ''} ${n <= 3 ? 'low' : ''}">
        <div class="av">${p.avatar}</div><div class="nm">${p.name}</div>
        <div class="ct"><b>${n}</b> tile${n === 1 ? '' : 's'}${p.melded ? ' ✔' : ''}</div></div>`;
    }).join('');
  }

  function tableHtml() {
    const sets = ui.humanTurn ? ui.turn.table : game.table;
    const startIds = ui.humanTurn ? new Set(ui.turn.startTable.flat()) : null;
    const armed = ui.humanTurn && ui.selected.size > 0;
    if (!sets.length && !ui.humanTurn) return '<div class="empty">The table is empty.<br>Sets that get played will appear here.</div>';
    const parts = sets.map((s, i) => {
      const a = RK.analyze(s);
      const valid = !!a;
      const jv = {};
      if (a) a.order.forEach((id, k) => { if (RK.isJoker(id)) jv[id] = a.values[k]; });
      const tiles = s.map((id) => tileHtml(id, {
        sel: ui.selected.has(id),
        fresh: ui.fresh.has(id),
        mine: ui.humanTurn && !startIds.has(id),
        jokerValue: jv[id],
        static: !ui.humanTurn,
      })).join('');
      const add = ui.humanTurn ? `<button class="add ${armed ? 'armed' : ''}" data-add="${i}" aria-label="Add selected tiles to this set">+</button>` : '';
      return `<div class="set ${valid ? '' : 'invalid'}">${tiles}${add}</div>`;
    });
    if (ui.humanTurn) parts.push(`<button class="newset ${armed ? 'armed' : ''}" data-act="newset">+ New set</button>`);
    return parts.join('');
  }

  function statusHtml() {
    let meld = '';
    if (ui.humanTurn && !game.players[0].melded) {
      const pts = RK.meldPoints(ui.turn.startTable, ui.turn.table);
      meld = `<span class="meld ${pts >= RK.MELD_MIN ? 'ok' : ''}">First meld ${pts}/${RK.MELD_MIN}</span>`;
    }
    return `<div class="statusbar"><div class="msg">${ui.status}</div>${meld}</div>`;
  }

  function rackHtml() {
    const rack = ui.humanTurn ? ui.turn.rack : game.players[0].rack;
    return sortedRack(rack).map((id) => tileHtml(id, {
      sel: ui.selected.has(id),
      fresh: ui.drawn === id,
      static: !ui.humanTurn,
    })).join('');
  }

  function controlsHtml() {
    if (!ui.humanTurn) return '<div class="actions"><button class="btn small ghost" data-act="sort" aria-label="Sort rack">Sort</button><span class="grow" style="color:var(--muted);text-align:right">Waiting for your turn…</span></div>';
    const sel = ui.selected.size;
    const t = ui.turn;
    const changed = t.history.length > 0;
    const pool = game.pool.length;
    const selbar = sel ? `<div class="selbar"><span>${sel} selected</span>
      <button class="btn small" data-act="newset">New set</button>
      <button class="btn small" data-act="torack">Back to rack</button>
      <button class="btn small ghost" data-act="clear">Clear</button></div>` : '';
    return `${selbar}<div class="actions">
      <button class="btn small ghost" data-act="sort" aria-label="Sort rack">Sort</button>
      <button class="btn small ghost" data-act="undo" ${changed ? '' : 'disabled'}>Undo</button>
      <span class="grow"></span>
      <button class="btn small" data-act="draw">${pool ? 'Draw tile' : 'Pass'}</button>
      <button class="btn small primary" data-act="end">End turn</button></div>`;
  }

  /* ---- animation: FLIP for tiles that moved, fly-in for tiles that appeared ---- */
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const centerOf = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  function tilePositions() {
    const m = new Map();
    document.querySelectorAll('#app .tile[data-id]').forEach((el) => m.set(el.dataset.id, el.getBoundingClientRect()));
    return m;
  }
  function flyIn(el, from, delay) {
    const r = el.getBoundingClientRect();
    const dx = from.x - (r.left + r.width / 2);
    const dy = from.y - (r.top + r.height / 2);
    el.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(.4) rotate(-12deg)`, opacity: 0 },
      { opacity: 1, offset: 0.25 },
      { transform: 'translate(0, 0) scale(1) rotate(0)', opacity: 1 },
    ], { duration: 520, delay: delay || 0, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
  }
  function flyGhost(from, to) {
    if (!from || !to || reduceMotion()) return;
    const g = document.createElement('div');
    g.className = 'tile back ghost';
    g.style.cssText = `position:fixed;left:${from.x - 20}px;top:${from.y - 27}px;z-index:15;pointer-events:none`;
    document.body.appendChild(g);
    const a = g.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: `translate(${to.x - from.x}px, ${to.y - from.y}px) scale(.5)`, opacity: .2 },
    ], { duration: 650, easing: 'ease-in-out' });
    a.onfinish = () => g.remove();
  }
  function animateAfterRender(prev) {
    if (reduceMotion()) { ui.origins.clear(); return; }
    document.querySelectorAll('#app .tile[data-id]').forEach((el) => {
      const id = el.dataset.id;
      const old = prev && prev.get(id);
      if (old) {
        const r = el.getBoundingClientRect();
        const dx = old.left - r.left; const dy = old.top - r.top;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
            { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
        }
      } else if (ui.origins.has(+id)) {
        const o = ui.origins.get(+id);
        flyIn(el, o.p, o.delay);
      }
    });
    ui.origins.clear();
  }

  function render() {
    const app = $('#app');
    const prev = ui.screen === 'game' ? tilePositions() : null;
    const keep = { t: 0, r: 0 };
    const tw = app.querySelector('.tablewrap'); const rk = app.querySelector('.rack');
    if (tw) keep.t = tw.scrollTop;
    if (rk) keep.r = rk.scrollTop;

    if (ui.screen === 'menu') {
      const saved = loadSaved();
      app.innerHTML = `<div class="start">
        <div class="tiles">${mt(2, 13)}${mt(1, 7)}${mj()}${mt(3, 1)}${mt(0, 10)}</div>
        <h1>Rummikub</h1>
        <p>You against four computer players.<br>Same rules for everyone — the tiles decide who wins.</p>
        <div class="stack">
          ${saved ? '<button class="btn primary" data-act="continue">Continue game</button>' : ''}
          <button class="btn ${saved ? '' : 'primary'}" data-act="new">${saved ? 'New game' : 'Play'}</button>
          <button class="btn ghost" data-act="tutorial">How to play</button>
        </div>
        <div class="version">Version ${VERSION}</div></div>`;
      return;
    }

    const poolN = game.pool.length;
    app.innerHTML = `
      <div class="topbar"><span class="title">Rummikub</span>
        <span class="pool" title="Tiles left to draw">🂠 ${poolN}</span>
        <button class="iconbtn" data-act="help" aria-label="How to play">?</button>
        <button class="iconbtn" data-act="menu" aria-label="Menu">☰</button></div>
      <div class="opps">${opponentsHtml()}</div>
      <div class="tablewrap"><div class="table">${tableHtml()}</div></div>
      ${statusHtml()}
      <div class="rackpanel"><div class="rack">${rackHtml()}</div>${controlsHtml()}</div>`;
    const tw2 = app.querySelector('.tablewrap'); const rk2 = app.querySelector('.rack');
    if (tw2) tw2.scrollTop = keep.t;
    if (rk2) rk2.scrollTop = keep.r;
    animateAfterRender(prev);
  }

  /* ------------------------------------------------------------------ toast / modal */
  let toastTimer = 0;
  function toast(msg, kind, ms) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), ms || 3200);
  }
  function openModal(html) { const m = $('#modal'); m.innerHTML = `<div class="sheet">${html}</div>`; m.classList.remove('hidden'); m.scrollTop = 0; }
  function closeModal() { $('#modal').classList.add('hidden'); $('#modal').innerHTML = ''; }

  function say(msg, persist) {
    ui.status = msg;
    if (persist) { ui.log.push(msg); if (ui.log.length > 60) ui.log.shift(); }
  }

  /* ------------------------------------------------------------------ persistence */
  function save() {
    if (!game || game.over) { store.del(KEYS.game); return; }
    store.set(KEYS.game, JSON.stringify({ game, log: ui.log.slice(-30) }));
  }
  function loadSaved() {
    const raw = store.get(KEYS.game);
    if (!raw) return null;
    try {
      const d = JSON.parse(raw);
      if (d && d.game && Array.isArray(d.game.players) && d.game.players.length === 5) return d;
    } catch (e) { /* corrupt */ }
    store.del(KEYS.game);
    return null;
  }

  /* ------------------------------------------------------------------ human turn editing */
  function snapshot() { ui.turn.history.push(JSON.stringify({ table: ui.turn.table, rack: ui.turn.rack })); }
  function restore(json) { const s = JSON.parse(json); ui.turn.table = s.table; ui.turn.rack = s.rack; }

  function moveSelected(target) {
    if (!ui.humanTurn) return;
    const sel = ui.selected;
    if (!sel.size) { toast('Tap some tiles first, then choose where they go.'); return; }
    const t = ui.turn;
    const ids = [...sel];
    if (target === 'rack') {
      const startIds = new Set(t.startTable.flat());
      if (ids.some((id) => startIds.has(id))) { toast("Tiles that were already on the table can't go back to your rack.", 'bad'); return; }
    }
    snapshot();
    ui.fresh = new Set();
    ui.drawn = null;
    let table = t.table.map((s) => s.filter((id) => !sel.has(id)));
    const rack = t.rack.filter((id) => !sel.has(id));
    if (target === 'rack') rack.push(...ids);
    else if (target === 'new') table.push(ids);
    else table[target].push(...ids);
    table = table.filter((s) => s.length).map(RK.normalizeSet);
    t.table = table;
    t.rack = rack;
    sel.clear();
    say('Keep going — red dashed sets are not valid yet.');
    render();
  }

  function startHumanTurn() {
    const p = game.players[0];
    ui.turn = {
      startTable: game.table.map((s) => s.slice()),
      startRack: p.rack.slice(),
      table: game.table.map((s) => s.slice()),
      rack: p.rack.slice(),
      history: [],
    };
    ui.selected = new Set();
    ui.humanTurn = true;
    say(p.melded
      ? 'Your turn — play tiles, rearrange the table, or draw.'
      : `Your turn — lay down sets worth ${RK.MELD_MIN}+ points from your rack, or draw.`);
    return new Promise((resolve) => { ui.endTurn = resolve; render(); });
  }

  function finishHumanTurn() {
    ui.humanTurn = false;
    ui.selected = new Set();
    const done = ui.endTurn; ui.endTurn = null;
    if (done) done();
  }

  function tryEndTurn() {
    const t = ui.turn;
    const p = game.players[0];
    const wasMelded = p.melded;
    const res = RK.validateTurn({ startTable: t.startTable, startRack: t.startRack, table: t.table, rack: t.rack, melded: wasMelded });
    if (!res.ok) { toast(res.error, 'bad', 4500); return; }
    const out = RK.commitMove(game, 0, t.table, t.rack);
    if (!out.ok) { toast(out.error, 'bad', 4500); return; }
    ui.fresh = new Set();
    ui.drawn = null;
    say(`You played ${out.played.length} tile${out.played.length === 1 ? '' : 's'}${wasMelded ? '' : ' and made your first meld'}.`, true);
    finishHumanTurn();
  }

  function drawTile() {
    const t = ui.turn;
    if (t.history.length && !confirm('Drawing ends your turn and undoes your changes. Continue?')) return;
    const id = RK.drawOrPass(game, 0);
    ui.fresh = new Set();
    ui.drawn = id;
    if (id !== null) ui.origins.set(id, { p: centerOf($('.pool')) || { x: 0, y: 0 }, delay: 0 });
    say(id === null ? 'You passed (no tiles left to draw).' : 'You drew a tile.', true);
    finishHumanTurn();
  }

  /* ------------------------------------------------------------------ AI turn */
  async function aiTurn(i, token) {
    const p = game.players[i];
    ui.thinking = i;
    say(`${p.name} is thinking…`);
    render();
    await sleep(900);
    if (token !== ui.token) return;
    let plan = null;
    try { plan = RKAI.planTurn(game, i); } catch (e) { console.error(e); }
    const oldKeys = game.table.map(RK.setKey);
    const wasMelded = p.melded;
    let done = false;
    if (plan) {
      const res = RK.commitMove(game, i, plan.table, plan.rack);
      if (res.ok) {
        done = true;
        ui.fresh = new Set(res.played);
        const chip = centerOf(document.querySelector(`.opps .opp:nth-child(${i})`));
        if (chip) res.played.forEach((id, k) => ui.origins.set(id, { p: chip, delay: k * 70 }));
        const newKeys = new Set(game.table.map(RK.setKey));
        const rearranged = oldKeys.some((k) => !newKeys.has(k));
        say(`${p.name} played ${res.played.length} tile${res.played.length === 1 ? '' : 's'}${wasMelded ? '' : ' (first meld!)'}${rearranged ? ' and rearranged the table' : ''}.`, true);
      }
    }
    if (!done) {
      const id = RK.drawOrPass(game, i);
      ui.fresh = new Set();
      if (id !== null) flyGhost(centerOf($('.pool')), centerOf(document.querySelector(`.opps .opp:nth-child(${i})`)));
      say(id === null ? `${p.name} passed.` : `${p.name} drew a tile.`, true);
    }
    ui.drawn = null;
    ui.thinking = -1;
    render();
    await sleep(game.over ? 300 : 1100);
  }

  /* ------------------------------------------------------------------ game flow */
  async function loop(token) {
    while (!game.over) {
      if (token !== ui.token) return;
      const i = game.current;
      save();
      if (game.players[i].human) await startHumanTurn();
      else await aiTurn(i, token);
      if (token !== ui.token) return;
      if (game.over) break;
      RK.advance(game);
      render();
    }
    if (token === ui.token) endGame();
  }

  function begin(g, log) {
    ui.token++;
    game = g;
    ui.screen = 'game';
    ui.log = log || [];
    ui.fresh = new Set();
    ui.drawn = null;
    ui.humanTurn = false;
    ui.selected = new Set();
    if (!log) say(`${game.players[game.current].name === 'You' ? 'You go' : game.players[game.current].name + ' goes'} first. Everyone starts with ${RK.HAND_SIZE} tiles.`, true);
    else say(ui.log[ui.log.length - 1] || 'Welcome back!');
    render();
    if (!log && !reduceMotion()) {
      const from = centerOf($('.pool'));
      if (from) document.querySelectorAll('.rack .tile').forEach((el, k) => flyIn(el, from, k * 45));
    }
    loop(ui.token);
  }

  function newGame() { store.del(KEYS.game); begin(RK.newGame()); }

  function endGame() {
    store.del(KEYS.game);
    ui.humanTurn = false;
    render();
    const w = game.winner;
    const rows = game.players.map((p, i) => ({ p, i, pts: RK.rackPoints(p.rack) }));
    const bonus = rows.reduce((s, r) => s + (r.i === w ? 0 : r.pts), 0);
    const score = (r) => (r.i === w ? bonus : -r.pts);
    const stalemate = game.pool.length === 0 && game.players[w].rack.length > 0;
    const head = w === 0 ? '🎉 You win!' : `${game.players[w].avatar} ${game.players[w].name} wins`;
    const sub = stalemate ? 'Nobody could move and the pool ran dry — the lowest rack takes it.' : (w === 0 ? 'You emptied your rack first.' : `${game.players[w].name} emptied their rack first.`);
    openModal(`<h2>${head}</h2><p>${sub}</p>
      <table class="scoretable"><tr><th>Player</th><th>Tiles left</th><th>Score</th></tr>
      ${rows.map((r) => `<tr class="${r.i === w ? 'win' : ''}"><td>${r.p.avatar} ${r.p.name}</td><td>${r.p.rack.length} (${r.pts} pts)</td><td>${score(r) > 0 ? '+' : ''}${score(r)}</td></tr>`).join('')}</table>
      <div class="row"><button class="btn primary grow" data-act="again">Play again</button><button class="btn ghost grow" data-act="tomenu">Menu</button></div>`);
  }

  function toMenu() { ui.token++; ui.humanTurn = false; ui.screen = 'menu'; closeModal(); render(); }

  /* ------------------------------------------------------------------ tutorial */
  const SLIDES = [
    () => `<h2>Welcome to Rummikub</h2>
      <p>Be the <b>first to get rid of every tile</b> on your rack by building sets on the table.</p>
      <p>You play against <b>four computer players</b>. Everybody follows the same rules and nobody gets any help — the luck of the draw decides who wins.</p>
      <div class="demo"><div class="line">${mt(2, 13)}${mt(1, 5)}${mj()}${mt(3, 9)}${mt(0, 1)}</div></div>`,
    () => `<h2>The tiles</h2>
      <ul><li>Numbers <b>1–13</b> in four colors: black ●, blue ■, red ▲ and orange ◆ (the symbol helps if colors are hard to tell apart).</li>
      <li>Every tile exists <b>twice</b>, plus <b>2 jokers</b> ★ — 106 tiles in all.</li>
      <li>Everyone is dealt <b>14 tiles</b>. The rest form the pool you draw from.</li></ul>
      <div class="demo"><div class="line">${mt(0, 4)}${mt(1, 4)}${mt(2, 4)}${mt(3, 4)}${mj()}</div></div>`,
    () => `<h2>Set 1: Runs</h2>
      <p>A run is <b>3 or more consecutive numbers of the same color</b>. 13 is the top — no wrapping round to 1.</p>
      <div class="demo"><div class="cap good">✔ Valid</div><div class="line">${mt(1, 4)}${mt(1, 5)}${mt(1, 6)}${mt(1, 7)}</div></div>
      <div class="demo"><div class="cap bad">✘ Mixed colors</div><div class="line">${mt(1, 4)}${mt(2, 5)}${mt(1, 6)}</div></div>
      <div class="demo"><div class="cap bad">✘ Wraps around</div><div class="line">${mt(0, 12)}${mt(0, 13)}${mt(0, 1)}</div></div>`,
    () => `<h2>Set 2: Groups</h2>
      <p>A group is <b>3 or 4 tiles of the same number, all in different colors</b>.</p>
      <div class="demo"><div class="cap good">✔ Valid</div><div class="line">${mt(0, 9)}${mt(1, 9)}${mt(3, 9)}</div></div>
      <div class="demo"><div class="cap bad">✘ Two tiles share a color</div><div class="line">${mt(0, 9)}${mt(0, 9)}${mt(3, 9)}</div></div>
      <div class="demo"><div class="cap bad">✘ Only two tiles</div><div class="line">${mt(0, 9)}${mt(1, 9)}</div></div>`,
    () => `<h2>Jokers</h2>
      <p>A joker ★ can stand in for <b>any tile</b> in a run or group.</p>
      <div class="demo"><div class="cap good">✔ Joker as the missing 6</div><div class="line">${mt(2, 5)}${mj(6)}${mt(2, 7)}</div></div>
      <div class="demo"><div class="cap good">✔ Joker as a fourth 8</div><div class="line">${mt(0, 8)}${mt(1, 8)}${mt(2, 8)}${mj(8)}</div></div>
      <ul><li>You can take a joker from the table only by <b>replacing it with the real tile</b> — and you must play the joker again in the same turn.</li>
      <li>Stuck with a joker at the end? It costs <b>30 points</b>.</li></ul>`,
    () => `<h2>Your turn</h2>
      <p>On your turn you do <b>one</b> of these:</p>
      <ul><li><b>Play</b> at least one tile from your rack — as new sets, by adding to sets already on the table, or by rearranging the table.</li>
      <li>Or <b>draw</b> one tile from the pool and end your turn.</li></ul>
      <p>You may reshuffle the table as much as you like, but when you press <b>End turn</b> every set must be valid and every tile that was on the table must still be there.</p>`,
    () => `<h2>Your first meld</h2>
      <p>The first time you play, your sets must add up to <b>at least 30 points</b> (a tile is worth its number), using <b>only tiles from your own rack</b>. You can't touch sets on the table until you've done this.</p>
      <div class="demo"><div class="cap good">✔ 11 + 12 + 13 = 36</div><div class="line">${mt(2, 11)}${mt(2, 12)}${mt(2, 13)}</div></div>
      <div class="demo"><div class="cap good">✔ 10+10+10 = 30, or two sets: 5+6+7 and 4+4+4 = 30</div><div class="line">${mt(0, 10)}${mt(1, 10)}${mt(3, 10)}</div></div>
      <p>A joker counts as the tile it stands for. The bar above your rack shows your total.</p>`,
    () => `<h2>How to move tiles</h2>
      <ul><li><b>Tap tiles</b> to select them — from your rack <i>or</i> from the table.</li>
      <li>Tap <b>+ New set</b> to start a set with the selection, or the <b>+</b> at the end of an existing set to add the selection to it.</li>
      <li><b>Back to rack</b> returns tiles you placed this turn.</li>
      <li><b>Undo</b> takes back your last move (tap it repeatedly). Sets with a red dashed outline aren't valid (yet).</li>
      <li>A green bar under a tile means you placed it this turn; a gold glow marks what the last player did.</li></ul>`,
    () => `<h2>Winning</h2>
      <p>The first player to empty their rack wins the round. Everyone else loses points for the tiles they're left holding (jokers cost 30), and the winner collects the total.</p>
      <p>If the pool runs dry and nobody can move, the player with the lowest rack wins.</p>
      <p style="margin-top:14px"><b>Good luck!</b> You can reopen this guide any time with the <b>?</b> button.</p>`,
  ];

  function showTutorial(i, first) {
    i = i || 0;
    const last = i === SLIDES.length - 1;
    openModal(`${SLIDES[i]()}
      <div class="dots">${SLIDES.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
      <div class="row">
        ${i > 0 ? `<button class="btn ghost" data-tut="${i - 1}">Back</button>` : `<button class="btn ghost" data-act="tutdone">${first ? 'Skip' : 'Close'}</button>`}
        <span class="grow"></span>
        ${last ? '<button class="btn primary" data-act="tutdone">Let’s play!</button>' : `<button class="btn primary" data-tut="${i + 1}">Next</button>`}
      </div>`);
    ui.tutFirst = !!first;
  }

  function tutDone() {
    store.set(KEYS.tut, '1');
    closeModal();
  }

  /* ------------------------------------------------------------------ menu */
  function showMenu() {
    openModal(`<h2>Menu</h2><div class="stack">
      <button class="btn" data-act="help">How to play</button>
      <button class="btn" data-act="log">Game log</button>
      <button class="btn" data-act="update">Check for updates</button>
      <button class="btn ghost" data-act="restart">Restart with a new deal</button>
      <button class="btn ghost" data-act="tomenu">Quit to title</button>
      <button class="btn ghost" data-act="closemodal">Close</button></div>
      <p class="version" style="text-align:center">Version ${VERSION}</p>`);
  }
  function showLog() {
    openModal(`<h2>Game log</h2><div class="logbox">${ui.log.slice().reverse().map((l) => `<div>${l}</div>`).join('') || '<div>Nothing yet.</div>'}</div>
      <div class="row"><button class="btn ghost grow" data-act="closemodal">Close</button></div>`);
  }

  /* ------------------------------------------------------------------ input */
  document.addEventListener('click', (e) => {
    const tileEl = e.target.closest('[data-tile]');
    if (tileEl && ui.humanTurn) {
      const id = +tileEl.dataset.tile;
      if (ui.selected.has(id)) ui.selected.delete(id); else ui.selected.add(id);
      render();
      return;
    }
    const add = e.target.closest('[data-add]');
    if (add) { moveSelected(+add.dataset.add); return; }
    const tut = e.target.closest('[data-tut]');
    if (tut) { showTutorial(+tut.dataset.tut, ui.tutFirst); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    switch (act) {
      case 'new': newGame(); break;
      case 'again': closeModal(); newGame(); break;
      case 'continue': { const d = loadSaved(); if (d) begin(d.game, d.log); break; }
      case 'tutorial': case 'help': showTutorial(0, false); break;
      case 'tutdone': tutDone(); break;
      case 'menu': showMenu(); break;
      case 'log': showLog(); break;
      case 'closemodal': closeModal(); break;
      case 'tomenu': toMenu(); break;
      case 'restart': if (confirm('Abandon this game and deal again?')) { closeModal(); newGame(); } break;
      case 'update': checkForUpdates(true); break;
      case 'newset': moveSelected('new'); break;
      case 'torack': moveSelected('rack'); break;
      case 'clear': ui.selected.clear(); render(); break;
      case 'sort': ui.sort = ui.sort === 'color' ? 'number' : 'color'; store.set(KEYS.sort, ui.sort); render(); toast(ui.sort === 'color' ? 'Rack sorted by color' : 'Rack sorted by number', '', 1200); break;
      case 'undo': if (ui.humanTurn && ui.turn.history.length) { restore(ui.turn.history.pop()); ui.selected.clear(); render(); } break;
      case 'end': if (ui.humanTurn) tryEndTurn(); break;
      case 'draw': if (ui.humanTurn) drawTile(); break;
      default: break;
    }
  });

  /* ------------------------------------------------------------------ self-updating PWA */
  let reloading = false;
  function reloadForUpdate() {
    if (reloading) return;
    reloading = true;
    try { sessionStorage.setItem('rk-resume', '1'); } catch (e) { /* ignore */ }
    toast('Updating to the latest version…', 'good', 2000);
    setTimeout(() => location.reload(), 500);
  }

  let swReg = null;
  async function checkForUpdates(manual) {
    if (!navigator.onLine) { if (manual) toast('You are offline.'); return; }
    try {
      if (swReg) await swReg.update();
      const txt = await (await fetch('version.js?_=' + Date.now(), { cache: 'no-store' })).text();
      const m = /APP_VERSION\s*=\s*'([^']*)'/.exec(txt);
      if (m && m[1] !== VERSION) {
        // The service worker normally triggers the reload itself; this is the belt-and-braces path.
        setTimeout(reloadForUpdate, 2500);
        if (manual) toast('New version found — updating…', 'good');
      } else if (manual) toast(`You have the latest version (${VERSION}).`, 'good');
    } catch (e) { if (manual) toast('Could not check for updates.', 'bad'); }
  }

  function setupUpdates() {
    if (!('serviceWorker' in navigator)) return;
    let controlled = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!controlled) { controlled = true; return; } // first install, nothing to refresh
      reloadForUpdate();
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      swReg = reg;
      checkForUpdates(false);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdates(false); });
      window.addEventListener('online', () => checkForUpdates(false));
      setInterval(() => checkForUpdates(false), 10 * 60 * 1000);
    }).catch(() => { /* e.g. file:// or private mode */ });
  }

  /* ------------------------------------------------------------------ boot */
  function boot() {
    render();
    let resume = false;
    try { resume = sessionStorage.getItem('rk-resume') === '1'; sessionStorage.removeItem('rk-resume'); } catch (e) { /* ignore */ }
    const saved = loadSaved();
    if (resume && saved) begin(saved.game, saved.log);
    else if (!store.get(KEYS.tut)) showTutorial(0, true);
    setupUpdates();
  }

  window.__rk = { get game() { return game; }, ui };
  boot();
})();
