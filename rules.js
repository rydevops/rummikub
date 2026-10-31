/* Rummikub rules engine. Works in the browser (global `RK`) and in Node (module.exports). */
(function (root) {
  'use strict';

  const COLORS = 4; // 0 black, 1 blue, 2 red, 3 orange
  const JOKER_A = 104;
  const JOKER_B = 105;
  const TOTAL_TILES = 106;
  const HAND_SIZE = 14;
  const MELD_MIN = 30;
  const JOKER_PENALTY = 30;

  const isJoker = (id) => id >= JOKER_A;
  const colorOf = (id) => Math.floor((id % 52) / 13);
  const valueOf = (id) => (id % 52) % 13 + 1;
  const tileType = (id) => (id % 52); // 0..51 : color*13 + value-1

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * Analyse a set of tile ids (order independent).
   * Returns null when the tiles do not form a legal run or group, otherwise
   * { type: 'run'|'group', order: ids in display order, values: value each tile stands for, points }.
   * Where a joker is ambiguous the highest-scoring reading is used.
   */
  function analyze(ids) {
    const n = ids.length;
    if (n < 3 || n > 13) return null;
    const nat = [];
    const jk = [];
    for (const id of ids) (isJoker(id) ? jk : nat).push(id);
    if (!nat.length) return null;
    let best = null;

    if (n <= 4) {
      const v = valueOf(nat[0]);
      const seen = new Set();
      let ok = true;
      for (const t of nat) {
        if (valueOf(t) !== v || seen.has(colorOf(t))) { ok = false; break; }
        seen.add(colorOf(t));
      }
      if (ok) {
        const order = nat.slice().sort((a, b) => colorOf(a) - colorOf(b)).concat(jk);
        best = { type: 'group', order, values: order.map(() => v), points: v * n };
      }
    }

    const c = colorOf(nat[0]);
    if (nat.every((t) => colorOf(t) === c)) {
      const sorted = nat.slice().sort((a, b) => valueOf(a) - valueOf(b));
      let distinct = true;
      for (let i = 1; i < sorted.length; i++) if (valueOf(sorted[i]) === valueOf(sorted[i - 1])) distinct = false;
      if (distinct) {
        const min = valueOf(sorted[0]);
        const max = valueOf(sorted[sorted.length - 1]);
        const span = max - min + 1;
        const gaps = span - nat.length;
        if (gaps <= jk.length) {
          const extra = jk.length - gaps;
          if (span + extra <= 13) {
            const up = Math.min(extra, 13 - max);
            const down = extra - up;
            const start = min - down;
            const byVal = new Map(sorted.map((t) => [valueOf(t), t]));
            let ji = 0;
            const order = [];
            const values = [];
            let points = 0;
            for (let v = start; v < start + n; v++) {
              order.push(byVal.has(v) ? byVal.get(v) : jk[ji++]);
              values.push(v);
              points += v;
            }
            if (!best || points > best.points) best = { type: 'run', order, values, points };
          }
        }
      }
    }
    return best;
  }

  const isValidSet = (ids) => analyze(ids) !== null;

  /** Best-effort display order: valid sets get their canonical order. */
  function normalizeSet(ids) {
    const a = analyze(ids);
    if (a) return a.order;
    const nat = ids.filter((t) => !isJoker(t)).sort((a2, b) => valueOf(a2) - valueOf(b) || colorOf(a2) - colorOf(b));
    return nat.concat(ids.filter(isJoker));
  }

  const setKey = (ids) => ids.slice().sort((a, b) => a - b).join(',');
  const rackPoints = (ids) => ids.reduce((s, id) => s + (isJoker(id) ? JOKER_PENALTY : valueOf(id)), 0);

  /**
   * Check a finished turn.
   * start/after tables are arrays of sets (arrays of ids); racks are arrays of ids.
   */
  function validateTurn({ startTable, startRack, table, rack, melded }) {
    const sets = table.filter((s) => s.length > 0);
    for (const s of sets) {
      if (!isValidSet(s)) {
        return { ok: false, error: 'Every set on the table must be a run (3+ consecutive numbers of one color) or a group (3–4 of the same number in different colors).' };
      }
    }
    const startTableIds = new Set(startTable.flat());
    const afterIds = new Set(sets.flat());
    const total = sets.reduce((s, x) => s + x.length, 0);
    if (afterIds.size !== total) return { ok: false, error: 'A tile appears twice on the table.' };
    for (const id of startTableIds) {
      if (!afterIds.has(id)) return { ok: false, error: 'Tiles that were already on the table must stay on the table.' };
    }
    const startRackSet = new Set(startRack);
    const played = [];
    for (const id of afterIds) {
      if (startTableIds.has(id)) continue;
      if (!startRackSet.has(id)) return { ok: false, error: 'Unknown tile on the table.' };
      played.push(id);
    }
    const rackSet = new Set(rack);
    if (rack.length + played.length !== startRack.length) return { ok: false, error: 'Rack does not add up.' };
    for (const id of rack) if (!startRackSet.has(id) || afterIds.has(id)) return { ok: false, error: 'Rack does not add up.' };
    if (rackSet.size !== rack.length) return { ok: false, error: 'Rack does not add up.' };
    if (played.length === 0) return { ok: false, error: 'You must play at least one tile from your rack.' };

    let points = 0;
    if (!melded) {
      const oldKeys = new Map();
      for (const s of startTable) oldKeys.set(setKey(s), (oldKeys.get(setKey(s)) || 0) + 1);
      for (const s of sets) {
        const k = setKey(s);
        if (oldKeys.get(k)) { oldKeys.set(k, oldKeys.get(k) - 1); continue; }
        if (s.some((id) => startTableIds.has(id))) {
          return { ok: false, error: 'Before your first meld you may not touch sets already on the table.' };
        }
        points += analyze(s).points;
      }
      for (const left of oldKeys.values()) {
        if (left > 0) return { ok: false, error: 'Before your first meld you may not touch sets already on the table.' };
      }
      if (points < MELD_MIN) {
        return { ok: false, error: `Your first meld must total at least ${MELD_MIN} points using only your own tiles (you have ${points}).`, points };
      }
    }
    return { ok: true, played, points };
  }

  /** Points of brand new sets (not matching an untouched set from the start of the turn). */
  function meldPoints(startTable, table) {
    const old = new Map();
    for (const s of startTable) old.set(setKey(s), (old.get(setKey(s)) || 0) + 1);
    let pts = 0;
    for (const s of table) {
      if (!s.length) continue;
      const k = setKey(s);
      if (old.get(k)) { old.set(k, old.get(k) - 1); continue; }
      const a = analyze(s);
      if (a) pts += a.points;
    }
    return pts;
  }

  const AI_NAMES = [
    { name: 'Ava', avatar: '🦊' },
    { name: 'Ben', avatar: '🐻' },
    { name: 'Cleo', avatar: '🐙' },
    { name: 'Dax', avatar: '🦉' },
  ];

  function newGame(seed) {
    if (seed === undefined) seed = (Math.random() * 4294967296) >>> 0;
    const rng = mulberry32(seed);
    const deck = shuffle(Array.from({ length: TOTAL_TILES }, (_, i) => i), rng);
    const players = [{ name: 'You', avatar: '🙂', human: true, rack: [], melded: false }];
    for (const p of AI_NAMES) players.push({ name: p.name, avatar: p.avatar, human: false, rack: [], melded: false });
    for (const p of players) p.rack = deck.splice(0, HAND_SIZE);
    return {
      seed,
      players,
      pool: deck,
      table: [],
      current: Math.floor(rng() * players.length),
      passes: 0,
      over: false,
      winner: null,
      turns: 0,
    };
  }

  /** Apply a validated move. Returns validateTurn's result. */
  function commitMove(game, idx, table, rack) {
    const p = game.players[idx];
    const res = validateTurn({ startTable: game.table, startRack: p.rack, table, rack, melded: p.melded });
    if (!res.ok) return res;
    game.table = table.filter((s) => s.length).map(normalizeSet);
    p.rack = rack.slice();
    p.melded = true;
    game.passes = 0;
    if (p.rack.length === 0) { game.over = true; game.winner = idx; }
    return res;
  }

  /** Draw a tile (or pass if the pool is empty). Returns the drawn id or null. */
  function drawOrPass(game, idx) {
    const p = game.players[idx];
    if (game.pool.length) {
      const id = game.pool.pop();
      p.rack.push(id);
      game.passes = 0;
      return id;
    }
    game.passes++;
    if (game.passes >= game.players.length) {
      game.over = true;
      let bestIdx = 0;
      let bestPts = Infinity;
      game.players.forEach((q, i) => {
        const pts = rackPoints(q.rack);
        if (pts < bestPts || (pts === bestPts && q.rack.length < game.players[bestIdx].rack.length)) { bestPts = pts; bestIdx = i; }
      });
      game.winner = bestIdx;
    }
    return null;
  }

  function advance(game) {
    game.current = (game.current + 1) % game.players.length;
    game.turns++;
  }

  const api = {
    COLORS, MELD_MIN, HAND_SIZE, JOKER_PENALTY,
    isJoker, colorOf, valueOf, tileType,
    mulberry32, shuffle,
    analyze, isValidSet, normalizeSet, setKey, rackPoints,
    validateTurn, meldPoints,
    newGame, commitMove, drawOrPass, advance,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RK = api;
})(typeof self !== 'undefined' ? self : this);
