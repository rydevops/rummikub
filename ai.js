/* Rummikub computer players. They see only what a human would: their own rack and the public table. */
(function (root) {
  'use strict';
  const RK = typeof require !== 'undefined' && typeof module !== 'undefined' ? require('./rules.js') : root.RK;
  const NODE_BUDGET = 25000;

  // ---- static catalogue of every set shape that can be built from tile "types" (color*13 + value-1) ----
  const CANDS = [];
  (function build() {
    for (let c = 0; c < 4; c++) {
      for (let s = 1; s <= 13; s++) {
        for (let L = 3; s + L - 1 <= 13; L++) {
          const types = [];
          let pts = 0;
          for (let k = 0; k < L; k++) { types.push(c * 13 + s - 1 + k); pts += s + k; }
          CANDS.push({ req: types, jokers: 0, min: types[0], points: pts, size: L });
          for (let p = 0; p < L; p++) {
            CANDS.push({ req: types.filter((_, i) => i !== p), jokers: 1, min: p === 0 ? types[1] : types[0], points: pts, size: L });
          }
          for (let p = 0; p < L; p++) {
            for (let q = p + 1; q < L; q++) {
              const req = types.filter((_, i) => i !== p && i !== q);
              CANDS.push({ req, jokers: 2, min: req[0], points: pts, size: L });
            }
          }
        }
      }
    }
    for (let v = 1; v <= 13; v++) {
      for (let mask = 1; mask < 16; mask++) {
        const req = [];
        for (let c = 0; c < 4; c++) if (mask & (1 << c)) req.push(c * 13 + v - 1);
        for (let k = 0; k <= 2; k++) {
          const size = req.length + k;
          if (size < 3 || size > 4) continue;
          CANDS.push({ req, jokers: k, min: req[0], points: v * size, size });
        }
      }
    }
  })();

  /**
   * Find the best way to lay disjoint sets from `rack` alone.
   * mode 'tiles': most tiles, then points.  mode 'points': most points, then tiles.
   * `preferred` ids are the ones used first when several tiles share a type.
   */
  function search(rack, mode, preferred) {
    const counts = new Array(52).fill(0);
    const buckets = Array.from({ length: 52 }, () => []);
    const jokers = [];
    const pref = new Set(preferred || []);
    const ordered = rack.filter((id) => !pref.has(id)).concat(rack.filter((id) => pref.has(id)));
    for (const id of ordered) {
      if (RK.isJoker(id)) jokers.push(id);
      else { counts[RK.tileType(id)]++; buckets[RK.tileType(id)].push(id); }
    }
    const J0 = jokers.length;
    const byMin = Array.from({ length: 52 }, () => []);
    for (const cd of CANDS) {
      if (cd.jokers > J0) continue;
      let ok = true;
      for (const t of cd.req) if (counts[t] === 0) { ok = false; break; }
      if (ok) byMin[cd.min].push(cd);
    }
    const score = (tiles, points) => (mode === 'points' ? points * 1000 + tiles : tiles * 1000 + points);
    const memo = new Map();
    let nodes = 0;
    const ZERO = { tiles: 0, points: 0, choice: null };

    function rec(J) {
      let p = 0;
      while (p < 52 && counts[p] === 0) p++;
      if (p >= 52) return ZERO;
      const key = counts.join('') + '|' + J;
      const hit = memo.get(key);
      if (hit) return hit;
      if (++nodes > NODE_BUDGET) return ZERO;
      counts[p]--;
      const skip = rec(J);
      counts[p]++;
      let best = { tiles: skip.tiles, points: skip.points, choice: null };
      let bestScore = score(best.tiles, best.points);
      for (const cd of byMin[p]) {
        if (cd.jokers > J) continue;
        let ok = true;
        for (const t of cd.req) if (counts[t] === 0) { ok = false; break; }
        if (!ok) continue;
        for (const t of cd.req) counts[t]--;
        const r = rec(J - cd.jokers);
        for (const t of cd.req) counts[t]++;
        const tiles = r.tiles + cd.size;
        const points = r.points + cd.points;
        const sc = score(tiles, points);
        if (sc > bestScore) { bestScore = sc; best = { tiles, points, choice: cd }; }
      }
      memo.set(key, best);
      return best;
    }

    const root = rec(J0);
    // Rebuild the chosen sets from real tile ids.
    const sets = [];
    const used = [];
    let J = J0;
    for (let guard = 0; guard < 200; guard++) {
      let p = 0;
      while (p < 52 && counts[p] === 0) p++;
      if (p >= 52) break;
      const m = memo.get(counts.join('') + '|' + J);
      if (!m) break;
      if (!m.choice) { counts[p]--; continue; }
      const cd = m.choice;
      const ids = [];
      for (const t of cd.req) { counts[t]--; ids.push(buckets[t].pop()); }
      // buckets popped from the end; a skipped tile of the same type may sit on top, so re-sync lazily
      for (let k = 0; k < cd.jokers; k++) ids.push(jokers.pop());
      J -= cd.jokers;
      sets.push(ids);
      used.push(...ids);
    }
    return { sets, used, tiles: root.tiles, points: root.points };
  }

  function removeIds(arr, ids) {
    const s = new Set(ids);
    return arr.filter((x) => !s.has(x));
  }

  function extendTable(tbl, rack) {
    let changed = true;
    while (changed) {
      changed = false;
      const naturals = rack.filter((t) => !RK.isJoker(t));
      for (const t of naturals) {
        for (let i = 0; i < tbl.length; i++) {
          if (tbl[i].length >= 13) continue;
          const cand = tbl[i].concat([t]);
          if (RK.isValidSet(cand)) {
            tbl[i] = RK.normalizeSet(cand);
            rack = removeIds(rack, [t]);
            changed = true;
            break;
          }
        }
      }
    }
    // Jokers are precious: only spend them if that finishes the game.
    const jk = rack.filter(RK.isJoker);
    if (jk.length && jk.length === rack.length) {
      const trial = tbl.map((s) => s.slice());
      let left = jk.slice();
      for (const j of jk) {
        for (let i = 0; i < trial.length; i++) {
          if (trial[i].length < 13 && RK.isValidSet(trial[i].concat([j]))) {
            trial[i] = RK.normalizeSet(trial[i].concat([j]));
            left = removeIds(left, [j]);
            break;
          }
        }
      }
      if (!left.length) { for (let i = 0; i < tbl.length; i++) tbl[i] = trial[i]; rack = []; }
    }
    return rack;
  }

  /** Ways to free up a natural tile (or a joker, by swapping in the real tile) from the table. */
  function borrowOps(tbl, rack) {
    const ops = [];
    tbl.forEach((s, i) => {
      const a = RK.analyze(s);
      if (!a) return;
      const tryRemove = (tile) => {
        const rest = s.filter((x) => x !== tile);
        if (RK.isValidSet(rest)) ops.push({ i, replace: [rest], gain: tile, give: null });
      };
      if (a.type === 'run' && s.length >= 4) {
        for (const tile of [a.order[0], a.order[a.order.length - 1]]) if (!RK.isJoker(tile)) tryRemove(tile);
        if (s.length >= 7) {
          for (let k = 3; k < s.length - 3; k++) {
            const tile = a.order[k];
            if (RK.isJoker(tile)) continue;
            const left = a.order.slice(0, k);
            const right = a.order.slice(k + 1);
            if (RK.isValidSet(left) && RK.isValidSet(right)) ops.push({ i, replace: [left, right], gain: tile, give: null });
          }
        }
      } else if (a.type === 'group' && s.length === 4) {
        for (const tile of s) if (!RK.isJoker(tile)) tryRemove(tile);
      }
      for (const j of s.filter(RK.isJoker)) {
        for (const n of rack) {
          if (RK.isJoker(n)) continue;
          const swapped = s.map((x) => (x === j ? n : x));
          if (RK.isValidSet(swapped)) ops.push({ i, replace: [RK.normalizeSet(swapped)], gain: j, give: n });
        }
      }
    });
    return ops;
  }

  /** Returns { table, rack } for a legal move, or null when the player should draw. */
  function planTurn(game, idx) {
    const P = game.players[idx];
    const startRack = P.rack.slice();
    let tbl = game.table.map((s) => s.slice());

    if (!P.melded) {
      const res = search(startRack, 'points');
      if (res.points < RK.MELD_MIN || !res.sets.length) return null;
      return { table: tbl.concat(res.sets.map(RK.normalizeSet)), rack: removeIds(startRack, res.used) };
    }

    let rack = startRack.slice();
    const first = search(rack, 'tiles');
    for (const s of first.sets) tbl.push(RK.normalizeSet(s));
    rack = removeIds(rack, first.used);
    rack = extendTable(tbl, rack);

    for (let iter = 0; iter < 6 && rack.length; iter++) {
      let bestOp = null;
      for (const op of borrowOps(tbl, rack)) {
        const rack2 = op.give === null ? rack.concat([op.gain]) : removeIds(rack, [op.give]).concat([op.gain]);
        const res = search(rack2, 'tiles', [op.gain]);
        if (!res.used.includes(op.gain)) continue;
        const after = rack2.length - res.used.length;
        const reduction = rack.length - after;
        if (reduction > 0 && (!bestOp || reduction > bestOp.reduction)) bestOp = { op, res, reduction, rack2 };
      }
      if (!bestOp) break;
      const { op, res, rack2 } = bestOp;
      const next = tbl.filter((_, i) => i !== op.i).concat(op.replace.map((s) => s.slice()), res.sets.map(RK.normalizeSet));
      tbl = next;
      rack = extendTable(tbl, removeIds(rack2, res.used));
    }

    if (rack.length === startRack.length) return null;
    return { table: tbl, rack };
  }

  const api = { planTurn, search };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RKAI = api;
})(typeof self !== 'undefined' ? self : this);
