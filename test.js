// Self-check: node test.js
const assert = require('assert');
const E = require('./engine.js');

const perft = (s, d) => d === 0 ? 1 : E.legal(s).reduce((n, m) => n + perft(m.next, d - 1), 0);
// Known perft counts (chessprogramming.org): covers castling, en passant, promotion, pins.
assert.strictEqual(perft(E.parseFEN(E.START), 3), 8902);
assert.strictEqual(perft(E.parseFEN('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'), 2), 2039);
assert.strictEqual(perft(E.parseFEN('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1'), 3), 2812);
assert.strictEqual(perft(E.parseFEN('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1'), 2), 264);

// Search finds mate in one and the SAN is right.
const s = E.parseFEN('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4');
const r = E.search(s, 1000);
assert.strictEqual(E.san(s, r.moves[0].m), 'Qxf7#');
assert.ok(r.moves[0].v > E.MATE - 100);

// Search grabs a free queen.
const q = E.parseFEN('4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1');
assert.strictEqual(E.san(q, E.search(q, 500).moves[0].m), 'Rxd5');

// Finds a forced mate in 3 (needs the check extension) and mate in 2.
const m3 = E.parseFEN('r1b1kb1r/pppp1ppp/5q2/4n3/3KP3/2N3PN/PPP4P/R1BQ1B1R b kq - 0 1');
assert.ok(E.search(m3, 1000).moves[0].v > E.MATE - 100, 'mate in 3 not found');
const m2 = E.parseFEN('r5k1/5ppp/8/8/8/8/3R1PPP/3R2K1 w - - 0 1');
assert.strictEqual(E.san(m2, E.search(m2, 1000).moves[0].m), 'Rd8+');

// Converts a won endgame: K+Q vs K must reach checkmate within 40 moves of self-play.
let kq = E.parseFEN('8/8/8/4k3/8/8/8/4K2Q w - - 0 1');
for (let i = 0; i < 80 && !E.status(kq); i++) kq = E.make(kq, E.search(kq, 200).moves[0].m);
assert.ok((E.status(kq) || '').startsWith('Checkmate'), 'K+Q vs K not converted');

const start = E.parseFEN(E.START), t = Date.now(), res = E.search(start, 1000);
console.log(`ok · start position depth ${res.depth} in ${Date.now() - t}ms, best ${E.san(start, res.moves[0].m)}`);
