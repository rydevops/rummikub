// Plays complete games with all five seats driven by the AI; every move goes through the rules engine.
const RK = require('../rules.js');
const AI = require('../ai.js');
const N = +process.argv[2] || 200;
const wins = [0, 0, 0, 0, 0];
let totalTurns = 0, maxTurns = 0, stalemates = 0, maxMs = 0, rejected = 0, draws = 0, plays = 0;
for (let s = 1001; s <= 1000 + N; s++) {
  const g = RK.newGame(s);
  let guard = 0;
  while (!g.over) {
    if (++guard > 2000) throw new Error('game ' + s + ' did not finish');
    const i = g.current;
    const t0 = Date.now();
    const plan = AI.planTurn(g, i);
    maxMs = Math.max(maxMs, Date.now() - t0);
    if (plan) {
      const res = RK.commitMove(g, i, plan.table, plan.rack);
      if (!res.ok) { rejected++; RK.drawOrPass(g, i); } else plays++;
    } else { draws++; RK.drawOrPass(g, i); }
    // invariant: 106 distinct tiles exist
    if (!g.over || true) {
      const all = g.players.flatMap((p) => p.rack).concat(g.pool, g.table.flat());
      if (all.length !== 106 || new Set(all).size !== 106) throw new Error('tile conservation broken in game ' + s);
      if (!g.table.every(RK.isValidSet)) throw new Error('invalid table in game ' + s);
    }
    if (!g.over) RK.advance(g);
  }
  if (g.pool.length === 0 && g.players[g.winner].rack.length) stalemates++;
  wins[g.winner]++;
  totalTurns += g.turns; maxTurns = Math.max(maxTurns, g.turns);
}
console.log({ games: N, wins, avgTurns: (totalTurns / N).toFixed(1), maxTurns, stalemates, rejectedAIMoves: rejected, plays, draws, slowestTurnMs: maxMs });
if (rejected) process.exit(1);
