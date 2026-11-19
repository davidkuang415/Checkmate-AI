// Checkmate AI engine: rules, evaluation, alpha-beta search, move explanations.
// Board: 64-array, index = row*8 + file, row 0 = rank 8. White pieces uppercase.

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
const NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const N = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
const B = [[-1,-1],[-1,1],[1,-1],[1,1]], R = [[-1,0],[1,0],[0,-1],[0,1]], K = [...B, ...R];

// Piece-square tables (white's view, rank 8 first). Black uses index ^ 56.
const PST = {
  p: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5,
      0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
  n: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30,
      -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
  b: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10,
      -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  r: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5,
      -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5,
      0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  k: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
      -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
  ke: [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30, -30,-10,30,40,40,30,-10,-30,
       -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30, -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50],
};

const color = p => p ? (p === p.toUpperCase() ? 'w' : 'b') : null;
const opp = c => c === 'w' ? 'b' : 'w';
const on = (r, f) => r >= 0 && r < 8 && f >= 0 && f < 8;
const sqName = sq => 'abcdefgh'[sq & 7] + (8 - (sq >> 3));
const kingSq = (b, c) => b.indexOf(c === 'w' ? 'K' : 'k');

function parseFEN(fen) {
  const [pos, turn, castle, ep, half, full] = fen.trim().split(/\s+/);
  const b = [];
  for (const ch of pos.replace(/\//g, '')) /\d/.test(ch) ? b.push(...Array(+ch).fill(null)) : b.push(ch);
  if (b.length !== 64) throw new Error('Bad FEN');
  const epSq = ep && ep !== '-' ? (8 - +ep[1]) * 8 + 'abcdefgh'.indexOf(ep[0]) : -1;
  return { b, turn: turn || 'w', castle: castle === '-' || !castle ? '' : castle, ep: epSq, half: +half || 0, full: +full || 1 };
}

// Position key for history lookups (board, side, castling, ep; no clocks).
function posKey(s) {
  let out = '';
  for (let r = 0; r < 8; r++) {
    let e = 0;
    for (let f = 0; f < 8; f++) { const p = s.b[r * 8 + f]; if (!p) e++; else { if (e) out += e; e = 0; out += p; } }
    if (e) out += e;
    if (r < 7) out += '/';
  }
  return `${out} ${s.turn} ${s.castle || '-'} ${s.ep < 0 ? '-' : sqName(s.ep)}`;
}

function attacked(b, sq, by) {
  const r = sq >> 3, f = sq & 7, w = by === 'w';
  const pr = w ? r + 1 : r - 1, P = w ? 'P' : 'p';
  for (const df of [-1, 1]) if (on(pr, f + df) && b[pr * 8 + f + df] === P) return true;
  const c = x => w ? x.toUpperCase() : x;
  for (const [dr, df] of N) if (on(r + dr, f + df) && b[(r + dr) * 8 + f + df] === c('n')) return true;
  for (const [dr, df] of K) if (on(r + dr, f + df) && b[(r + dr) * 8 + f + df] === c('k')) return true;
  for (const [dirs, a] of [[B, c('b')], [R, c('r')]]) for (const [dr, df] of dirs) {
    let rr = r + dr, ff = f + df;
    while (on(rr, ff)) { const p = b[rr * 8 + ff]; if (p) { if (p === a || p === c('q')) return true; break; } rr += dr; ff += df; }
  }
  return false;
}

function pseudo(s) {
  const { b, turn } = s, ms = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = b[sq];
    if (!p || color(p) !== turn) continue;
    const r = sq >> 3, f = sq & 7, t = p.toLowerCase();
    const add = (to, flag) => ms.push({ from: sq, to, piece: p, captured: flag === 'ep' ? (turn === 'w' ? 'p' : 'P') : b[to], flag });
    if (t === 'p') {
      const dir = turn === 'w' ? -1 : 1, start = turn === 'w' ? 6 : 1, last = turn === 'w' ? 0 : 7;
      const push = to => (to >> 3) === last
        ? [...'qrbn'].forEach(x => ms.push({ from: sq, to, piece: p, captured: b[to], promo: turn === 'w' ? x.toUpperCase() : x }))
        : add(to);
      if (!b[(r + dir) * 8 + f]) {
        push((r + dir) * 8 + f);
        if (r === start && !b[(r + 2 * dir) * 8 + f]) add((r + 2 * dir) * 8 + f, 'double');
      }
      for (const df of [-1, 1]) {
        if (!on(r + dir, f + df)) continue;
        const to = (r + dir) * 8 + f + df;
        if (b[to] && color(b[to]) !== turn) push(to);
        else if (to === s.ep) add(to, 'ep');
      }
    } else if (t === 'n' || t === 'k') {
      for (const [dr, df] of t === 'n' ? N : K) {
        if (!on(r + dr, f + df)) continue;
        const to = (r + dr) * 8 + f + df;
        if (color(b[to]) !== turn) add(to);
      }
      if (t === 'k') {
        const [k, q, home, rook, o] = turn === 'w' ? ['K', 'Q', 60, 'R', 'b'] : ['k', 'q', 4, 'r', 'w'];
        if (sq === home && !attacked(b, home, o)) {
          if (s.castle.includes(k) && !b[home + 1] && !b[home + 2] && b[home + 3] === rook &&
              !attacked(b, home + 1, o) && !attacked(b, home + 2, o)) add(home + 2, 'castle');
          if (s.castle.includes(q) && !b[home - 1] && !b[home - 2] && !b[home - 3] && b[home - 4] === rook &&
              !attacked(b, home - 1, o) && !attacked(b, home - 2, o)) add(home - 2, 'castle');
        }
      }
    } else {
      for (const [dr, df] of t === 'b' ? B : t === 'r' ? R : K) {
        let rr = r + dr, ff = f + df;
        while (on(rr, ff)) {
          const to = rr * 8 + ff;
          if (b[to]) { if (color(b[to]) !== turn) add(to); break; }
          add(to); rr += dr; ff += df;
        }
      }
    }
  }
  return ms;
}

const ROOK_CASTLE = { 62: [63, 61], 58: [56, 59], 6: [7, 5], 2: [0, 3] };
const CASTLE_LOSS = [[60, 'KQ'], [63, 'K'], [56, 'Q'], [4, 'kq'], [7, 'k'], [0, 'q']];

function make(s, m) {
  const b = s.b.slice(), w = s.turn === 'w';
  b[m.to] = m.promo || m.piece; b[m.from] = null;
  if (m.flag === 'ep') b[m.to + (w ? 8 : -8)] = null;
  if (m.flag === 'castle') { const [rf, rt] = ROOK_CASTLE[m.to]; b[rt] = b[rf]; b[rf] = null; }
  let castle = s.castle;
  for (const [sq, lost] of CASTLE_LOSS) if (m.from === sq || m.to === sq) castle = castle.replace(new RegExp(`[${lost}]`, 'g'), '');
  return {
    b, turn: w ? 'b' : 'w', castle,
    ep: m.flag === 'double' ? (m.from + m.to) / 2 : -1,
    half: m.piece.toLowerCase() === 'p' || m.captured ? 0 : s.half + 1,
    full: s.full + (w ? 0 : 1),
  };
}

// Legal moves; each carries its resulting position in m.next.
function legal(s) {
  const out = [];
  for (const m of pseudo(s)) {
    const n = make(s, m);
    if (!attacked(n.b, kingSq(n.b, s.turn), n.turn)) { m.next = n; out.push(m); }
  }
  return out;
}

const inCheck = s => attacked(s.b, kingSq(s.b, s.turn), opp(s.turn));

function status(s) {
  if (!legal(s).length) return inCheck(s) ? `Checkmate. ${s.turn === 'w' ? 'Black' : 'White'} wins.` : 'Stalemate. Draw.';
  if (s.half >= 100) return 'Draw by the 50-move rule.';
  return null; // ponytail: no threefold-repetition or insufficient-material detection; needs position history
}

function san(s, m) {
  const t = m.piece.toLowerCase(), F = 'abcdefgh';
  let out;
  if (m.flag === 'castle') out = (m.to & 7) === 6 ? 'O-O' : 'O-O-O';
  else if (t === 'p') out = (m.captured ? F[m.from & 7] + 'x' : '') + sqName(m.to) + (m.promo ? '=' + m.promo.toUpperCase() : '');
  else {
    const rivals = legal(s).filter(o => o.piece === m.piece && o.to === m.to && o.from !== m.from);
    let dis = '';
    if (rivals.length) {
      if (!rivals.some(o => (o.from & 7) === (m.from & 7))) dis = F[m.from & 7];
      else if (!rivals.some(o => (o.from >> 3) === (m.from >> 3))) dis = String(8 - (m.from >> 3));
      else dis = sqName(m.from);
    }
    out = t.toUpperCase() + dis + (m.captured ? 'x' : '') + sqName(m.to);
  }
  const n = make(s, m);
  if (inCheck(n)) out += legal(n).length ? '+' : '#';
  return out;
}

const dist = (a, b) => Math.abs((a >> 3) - (b >> 3)) + Math.abs((a & 7) - (b & 7));
const centerDist = sq => Math.max(3 - (sq >> 3), (sq >> 3) - 4) + Math.max(3 - (sq & 7), (sq & 7) - 4);

// Static evaluation in centipawns from White's view: material + piece-square tables,
// plus "play to win" terms once one side is clearly ahead.
function evaluate(s) {
  const b = s.b;
  let score = 0, npm = 0, mat = 0;
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p || p === 'k' || p === 'K') continue;
    const v = VAL[p.toLowerCase()];
    mat += p === p.toUpperCase() ? v : -v;
    if (!'pP'.includes(p)) npm += v;
  }
  const endgame = npm <= 2600;
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p) continue;
    const t = p.toLowerCase(), w = p !== t;
    const v = VAL[t] + (t === 'k' && endgame ? PST.ke : PST[t])[w ? i : i ^ 56];
    score += w ? v : -v;
  }
  if (Math.abs(mat) >= 200) {
    const sign = Math.sign(mat);
    // Ahead in material: trades favor the winning side (fewer pieces left = easier win).
    score += sign * Math.max(0, 6200 - npm) / 40;
    // Endgame: drive the losing king to the edge and bring our king close so checkmate actually happens.
    if (endgame) {
      const wk = kingSq(b, 'w'), bk = kingSq(b, 'b'), loser = sign > 0 ? bk : wk;
      score += sign * (12 * centerDist(loser) + 5 * (14 - dist(wk, bk)));
    }
  }
  return score;
}

const ORD = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 10 };
const mvv = m => (m.captured ? 100 * ORD[m.captured.toLowerCase()] - ORD[m.piece.toLowerCase()] : 0) + (m.promo ? 800 : 0);
const MATE = 100000, STOP = {};

// Iterative deepening negamax with alpha-beta + quiescence. Returns every root move with a score
// (side-to-move view) so the UI can grade played moves and predict replies.
function search(s, ms = 1000, maxDepth = 30) {
  const deadline = Date.now() + ms;
  let nodes = 0;
  const tick = () => { if ((++nodes & 1023) === 0 && Date.now() > deadline) throw STOP; };

  function qs(s, a, bt) {
    tick();
    const stand = (s.turn === 'w' ? 1 : -1) * evaluate(s);
    if (stand >= bt) return stand;
    if (stand > a) a = stand;
    const caps = pseudo(s).filter(m => m.captured || m.promo).sort((x, y) => mvv(y) - mvv(x));
    for (const m of caps) {
      const n = make(s, m);
      if (attacked(n.b, kingSq(n.b, s.turn), n.turn)) continue;
      const v = -qs(n, -bt, -a);
      if (v >= bt) return v;
      if (v > a) a = v;
    }
    return a;
  }

  function nm(s, d, a, bt, ply) {
    tick();
    const check = inCheck(s);
    // Check extension: keep searching forcing lines one ply deeper so forced mates aren't cut off at the horizon.
    if (check && ply < 24) d++;
    if (d <= 0) return { v: qs(s, a, bt), pv: [] };
    const moves = legal(s);
    if (!moves.length) return { v: check ? -MATE + ply : 0, pv: [] };
    if (s.half >= 100) return { v: 0, pv: [] };
    moves.sort((x, y) => mvv(y) - mvv(x));
    let best = { v: -Infinity, pv: [] };
    for (const m of moves) {
      const r = nm(m.next, d - 1, -bt, -a, ply + 1), v = -r.v;
      if (v > best.v) { best = { v, pv: [m, ...r.pv] }; if (v > a) a = v; if (a >= bt) break; }
    }
    return best;
  }

  let root = legal(s).sort((x, y) => mvv(y) - mvv(x)).map(m => ({ m, v: 0, pv: [m] }));
  let result = { depth: 0, nodes: 0, moves: root };
  if (!root.length) return result;
  try {
    for (let d = 1; d <= maxDepth; d++) {
      const scored = [];
      let alpha = -MATE - 1;
      for (const rm of root) {
        // ponytail: root window is best-300cp, so moves >3 pawns worse get only an upper bound (graded "blunder" either way)
        const r = nm(rm.m.next, d - 1, -MATE - 1, -alpha, 1), v = -r.v;
        scored.push({ m: rm.m, v, pv: [rm.m, ...r.pv], exact: v > alpha }); // exact=false: v is only an upper bound
        if (v - 300 > alpha) alpha = v - 300;
      }
      scored.sort((x, y) => y.v - x.v);
      root = scored;
      result = { depth: d, nodes, moves: scored };
      if (Math.abs(scored[0].v) > MATE - 100) break;
    }
  } catch (e) { if (e !== STOP) throw e; }
  result.nodes = nodes;
  return result;
}

// ---- Teaching helpers ----

function features(s, c) {
  const b = s.b, w = c === 'w';
  let mat = 0;
  for (const p of b) if (p && !'kK'.includes(p)) mat += (color(p) === c ? 1 : -1) * VAL[p.toLowerCase()];
  const homes = w ? [[57, 'N'], [62, 'N'], [58, 'B'], [61, 'B']] : [[1, 'n'], [6, 'n'], [2, 'b'], [5, 'b']];
  const dev = homes.filter(([sq, p]) => b[sq] !== p).length;
  const center = [27, 28, 35, 36].reduce((n, sq) => n + attacked(b, sq, c) + (color(b[sq]) === c), 0);
  const k = kingSq(b, c), kr = k >> 3, kf = k & 7, dir = w ? -1 : 1, P = w ? 'P' : 'p';
  let shield = 0;
  for (let df = -1; df <= 1; df++) for (const dr of [dir, 2 * dir]) if (on(kr + dr, kf + df) && b[(kr + dr) * 8 + kf + df] === P) shield++;
  const mob = pseudo({ ...s, turn: c, ep: -1 }).length;
  return { mat, dev, center, shield, mob };
}

// Plain-English reasons for a move, from the mover's point of view.
function explain(s, m) {
  const me = s.turn, them = opp(me), n = make(s, m), t = m.piece.toLowerCase(), out = [];
  const pre = features(s, me), post = features(n, me);
  const at = sq => `${NAME[n.b[sq].toLowerCase()]} on ${sqName(sq)}`;

  if (inCheck(n) && !legal(n).length) return ['Checkmate. The game is over.'];
  if (m.flag === 'castle') out.push('Castles: the king tucks away to safety and the rook comes toward the center.');
  if (m.promo) out.push(`Promotes the pawn to a ${NAME[m.promo.toLowerCase()]}.`);
  if (m.captured) {
    const cv = VAL[m.captured.toLowerCase()], mv = VAL[t], recapture = attacked(n.b, m.to, them);
    if (!recapture) out.push(`Wins a ${NAME[m.captured.toLowerCase()]} for free.`);
    else if (cv > mv) out.push(`Wins material: takes a ${NAME[m.captured.toLowerCase()]} with a ${NAME[t]}.`);
    else if (cv === mv) out.push(`Trades ${NAME[t]}s.`);
    else out.push(`Takes a ${NAME[m.captured.toLowerCase()]}, but the ${NAME[t]} can be recaptured.`);
  }
  if (inCheck(n)) out.push('Gives check, so the opponent must respond to it.');

  // New threats: enemy pieces attacked now but not before that are undefended or worth more than the mover.
  const threats = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = n.b[sq];
    if (color(p) !== them || 'kK'.includes(p) || sq === m.to) continue;
    if (attacked(n.b, sq, me) && !attacked(s.b, sq, me) && (!attacked(n.b, sq, them) || VAL[p.toLowerCase()] > VAL[t])) threats.push(sq);
  }
  if (threats.length >= 2) out.push(`Creates a double attack on the ${at(threats[0])} and the ${at(threats[1])}.`);
  else if (threats.length) out.push(`Threatens the ${at(threats[0])}.`);

  if (t !== 'k' && attacked(n.b, m.to, them) && !attacked(n.b, m.to, me))
    out.push(`Careful: the ${NAME[(m.promo || t).toLowerCase()]} on ${sqName(m.to)} is undefended and can be taken.`);
  if (post.dev > pre.dev && s.full <= 15) out.push(`Develops the ${NAME[t]} so it joins the game.`);
  if (post.center > pre.center) out.push('Increases control of the center (d4, e4, d5, e5).');
  if (post.shield < pre.shield && m.flag !== 'castle' && t !== 'k') out.push('Weakens the pawn cover in front of your king.');
  if (t === 'r' && !n.b.some((p, i) => (i & 7) === (m.to & 7) && p && p.toLowerCase() === 'p')) out.push('Puts the rook on an open file.');
  if (post.mob - pre.mob >= 5) out.push(`Opens lines for your pieces (+${post.mob - pre.mob} available moves).`);
  if (!out.length) {
    const tbl = t === 'k' ? PST.k : PST[t], idx = sq => me === 'w' ? sq : sq ^ 56;
    out.push(tbl[idx(m.to)] > tbl[idx(m.from)] ? `Moves the ${NAME[t]} to a more active square.` : 'A quiet move that keeps the position stable.');
  }
  return out;
}

function grade(loss) {
  if (loss <= 15) return { label: 'Best', tone: 'success' };
  if (loss <= 50) return { label: 'Good', tone: 'success' };
  if (loss <= 120) return { label: 'Inaccuracy', tone: 'warning' };
  if (loss < 300) return { label: 'Mistake', tone: 'warning' }; // 300 = search window cap, so >= 300 means "at least 3 pawns"
  return { label: 'Blunder', tone: 'danger' };
}

function fmtScore(v) {
  if (Math.abs(v) > MATE - 100) return `${v > 0 ? '' : '-'}M${Math.ceil((MATE - Math.abs(v)) / 2)}`;
  return (v > 0 ? '+' : '') + (v / 100).toFixed(2);
}

if (typeof module !== 'undefined') module.exports = { START, parseFEN, posKey, legal, make, san, search, explain, evaluate, status, inCheck, grade, fmtScore, sqName, MATE };
