const assert = require('assert');
const RK = require('../rules.js');

// helpers: tile id from color (0-3), value (1-13), copy (0/1)
const T = (c, v, copy = 0) => copy * 52 + c * 13 + v - 1;
const J1 = 104, J2 = 105;
const ok = (ids) => assert.ok(RK.isValidSet(ids), 'expected valid: ' + ids);
const bad = (ids) => assert.ok(!RK.isValidSet(ids), 'expected invalid: ' + ids);

// runs
ok([T(0, 3), T(0, 4), T(0, 5)]);
ok([T(1, 11), T(1, 12), T(1, 13)]);
bad([T(0, 3), T(0, 4)]);                       // too short
bad([T(0, 3), T(0, 4), T(1, 5)]);              // mixed colors
bad([T(0, 12), T(0, 13), T(0, 1)]);            // no wrap-around
bad([T(0, 3), T(0, 3, 1), T(0, 4)]);           // duplicate value
bad([T(0, 3), T(0, 4), T(0, 6)]);              // gap
ok([T(0, 3), J1, T(0, 5)]);                    // joker fills gap
ok([T(0, 12), T(0, 13), J1]);                  // joker extends down
ok([T(0, 1), T(0, 2), J1, J2]);                // two jokers
bad([T(0, 3), T(0, 6), J1]);                   // gap of two, one joker
ok(Array.from({ length: 13 }, (_, i) => T(2, i + 1)));
bad(Array.from({ length: 13 }, (_, i) => T(2, i + 1)).concat([J1]));
// groups
ok([T(0, 7), T(1, 7), T(2, 7)]);
ok([T(0, 7), T(1, 7), T(2, 7), T(3, 7)]);
bad([T(0, 7), T(1, 7), T(2, 7), T(3, 7), J1]); // 5 tiles
bad([T(0, 7), T(0, 7, 1), T(2, 7)]);           // same color twice
bad([T(0, 7), T(1, 8), T(2, 7)]);
ok([T(0, 7), T(1, 7), J1]);
ok([T(0, 7), J1, J2]);
bad([J1, J2]);
bad([J1, J2, T(0, 1), T(1, 2)]);

// points
assert.strictEqual(RK.analyze([T(0, 10), T(1, 10), T(2, 10)]).points, 30);
assert.strictEqual(RK.analyze([T(0, 3), T(0, 4), T(0, 5)]).points, 12);
assert.strictEqual(RK.analyze([T(0, 5), T(0, 6), J1]).points, 18); // joker counts as 7 (best reading)
assert.strictEqual(RK.analyze([T(0, 12), T(0, 13), J1]).points, 36); // 11+12+13

// ---- turn validation ----
const v = (o) => RK.validateTurn(Object.assign({ startTable: [], melded: false }, o));
// first meld too low
let r = v({ startRack: [T(0, 3), T(0, 4), T(0, 5), T(1, 1)], table: [[T(0, 3), T(0, 4), T(0, 5)]], rack: [T(1, 1)] });
assert.ok(!r.ok && /30/.test(r.error));
// first meld exactly 30
r = v({ startRack: [T(0, 10), T(1, 10), T(2, 10), T(1, 1)], table: [[T(0, 10), T(1, 10), T(2, 10)]], rack: [T(1, 1)] });
assert.ok(r.ok && r.points === 30);
// first meld may combine sets
r = v({ startRack: [T(0, 5), T(0, 6), T(0, 7), T(1, 6), T(1, 7), T(1, 8), T(3, 9), T(3, 10), T(3, 11)], table: [[T(0, 5), T(0, 6), T(0, 7)], [T(1, 6), T(1, 7), T(1, 8)], [T(3, 9), T(3, 10), T(3, 11)]], rack: [] });
assert.ok(r.ok && r.points === 18 + 21 + 30);
// must play something
r = v({ startRack: [T(0, 1)], startTable: [[T(0, 3), T(0, 4), T(0, 5)]], melded: true, table: [[T(0, 3), T(0, 4), T(0, 5)]], rack: [T(0, 1)] });
assert.ok(!r.ok);
// can't take tiles from the table
r = v({ startRack: [T(0, 1)], startTable: [[T(0, 3), T(0, 4), T(0, 5)]], melded: true, table: [], rack: [T(0, 1), T(0, 3), T(0, 4), T(0, 5)] });
assert.ok(!r.ok);
// can't invent tiles
r = v({ startRack: [T(0, 1)], melded: true, table: [[T(0, 3), T(0, 4), T(0, 5)]], rack: [T(0, 1)] });
assert.ok(!r.ok);
// melded: extend a run + rearrange
const st = [[T(0, 3), T(0, 4), T(0, 5), T(0, 6)], [T(1, 8), T(2, 8), T(3, 8)]];
r = v({ startRack: [T(0, 8, 1), T(0, 7), T(9 % 4, 1)], startTable: st, melded: true, table: [[T(0, 3), T(0, 4), T(0, 5), T(0, 6), T(0, 7)], [T(1, 8), T(2, 8), T(3, 8), T(0, 8, 1)]], rack: [T(9 % 4, 1)] });
assert.ok(r.ok, r.error);
// un-melded players may not touch the table
r = v({ startRack: [T(0, 7), T(0, 10), T(1, 10), T(2, 10)], startTable: st, melded: false, table: [[T(0, 3), T(0, 4), T(0, 5), T(0, 6), T(0, 7)], [T(1, 8), T(2, 8), T(3, 8)], [T(0, 10), T(1, 10), T(2, 10)]], rack: [] });
assert.ok(!r.ok && /first meld/.test(r.error));
// un-melded players may add a separate 30pt meld while leaving the table intact
r = v({ startRack: [T(0, 10), T(1, 10), T(2, 10)], startTable: st, melded: false, table: st.concat([[T(0, 10), T(1, 10), T(2, 10)]]), rack: [] });
assert.ok(r.ok);
// joker swap: replace the joker with the real tile and reuse the joker
const jt = [[T(0, 3), J1, T(0, 5)]];
r = v({ startRack: [T(0, 4), T(1, 9), T(2, 9)], startTable: jt, melded: true, table: [[T(0, 3), T(0, 4), T(0, 5)], [J1, T(1, 9), T(2, 9)]], rack: [] });
assert.ok(r.ok, r.error);
// ...but taking a joker without a valid use is rejected
r = v({ startRack: [T(0, 4)], startTable: jt, melded: true, table: [[T(0, 3), T(0, 4), T(0, 5)]], rack: [J1] });
assert.ok(!r.ok);

// ---- game setup ----
const g = RK.newGame(42);
assert.strictEqual(g.players.length, 5);
assert.strictEqual(g.players.filter((p) => p.human).length, 1);
g.players.forEach((p) => assert.strictEqual(p.rack.length, 14));
assert.strictEqual(g.pool.length, 106 - 70);
assert.strictEqual(new Set(g.players.flatMap((p) => p.rack).concat(g.pool)).size, 106);
// ---- standings ----
const sg = RK.newGame(7);
sg.over = true; sg.winner = 2;
sg.players[0].rack = [T(0, 5), T(0, 6)];          // 11 pts, 2 tiles
sg.players[1].rack = [T(0, 3), T(1, 3), T(2, 3)]; // 9 pts, 3 tiles
sg.players[2].rack = [];                          // winner
sg.players[3].rack = [T(0, 4), T(1, 7)];          // 11 pts, 2 tiles -> ties with player 0
sg.players[4].rack = [J1];                        // 30 pts
const st2 = RK.standings(sg);
assert.deepStrictEqual(st2.map((r) => r.idx), [2, 1, 0, 3, 4]);
assert.deepStrictEqual(st2.map((r) => r.place), [1, 2, 3, 3, 5]);
console.log('rules tests passed');
