/**
 * Cards are 0–51. Rank is card % 13 (0 = deuce … 12 = ace). Suit is floor(card / 13)
 * (0 spades, 1 hearts, 2 diamonds, 3 clubs).
 * Score layout: category in bits 20–23, then up to five kickers of 4 bits.
 * Higher score wins. Categories: 8 straight flush, 7 quads, 6 full house,
 * 5 flush, 4 straight, 3 trips, 2 two pair, 1 pair, 0 high card.
 */

const COUNTS = new Uint8Array(13);

const C65: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [0, 1, 2, 3, 4],
  [0, 1, 2, 3, 5],
  [0, 1, 2, 4, 5],
  [0, 1, 3, 4, 5],
  [0, 2, 3, 4, 5],
  [1, 2, 3, 4, 5],
];

const C75: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [0, 1, 2, 3, 4],
  [0, 1, 2, 3, 5],
  [0, 1, 2, 3, 6],
  [0, 1, 2, 4, 5],
  [0, 1, 2, 4, 6],
  [0, 1, 2, 5, 6],
  [0, 1, 3, 4, 5],
  [0, 1, 3, 4, 6],
  [0, 1, 3, 5, 6],
  [0, 1, 4, 5, 6],
  [0, 2, 3, 4, 5],
  [0, 2, 3, 4, 6],
  [0, 2, 3, 5, 6],
  [0, 2, 4, 5, 6],
  [0, 3, 4, 5, 6],
  [1, 2, 3, 4, 5],
  [1, 2, 3, 4, 6],
  [1, 2, 3, 5, 6],
  [1, 2, 4, 5, 6],
  [1, 3, 4, 5, 6],
  [2, 3, 4, 5, 6],
];

function pack(cat: number, a = 0, b = 0, c = 0, d = 0, e = 0): number {
  return (
    (cat << 20) |
    ((a & 15) << 16) |
    ((b & 15) << 12) |
    ((c & 15) << 8) |
    ((d & 15) << 4) |
    (e & 15)
  );
}

function flushScore(r0: number, r1: number, r2: number, r3: number, r4: number): number {
  let a = r0;
  let b = r1;
  let c = r2;
  let d = r3;
  let e = r4;
  const swap = () => {
    if (a < b) {
      const t = a;
      a = b;
      b = t;
    }
    if (b < c) {
      const t = b;
      b = c;
      c = t;
    }
    if (c < d) {
      const t = c;
      c = d;
      d = t;
    }
    if (d < e) {
      const t = d;
      d = e;
      e = t;
    }
  };
  swap();
  swap();
  swap();
  swap();
  return pack(5, a, b, c, d, e);
}

export function evaluate5(
  c0: number,
  c1: number,
  c2: number,
  c3: number,
  c4: number,
): number {
  const r0 = c0 % 13;
  const r1 = c1 % 13;
  const r2 = c2 % 13;
  const r3 = c3 % 13;
  const r4 = c4 % 13;
  COUNTS.fill(0);
  COUNTS[r0]++;
  COUNTS[r1]++;
  COUNTS[r2]++;
  COUNTS[r3]++;
  COUNTS[r4]++;

  const s0 = (c0 / 13) | 0;
  const flush =
    s0 === ((c1 / 13) | 0) &&
    s0 === ((c2 / 13) | 0) &&
    s0 === ((c3 / 13) | 0) &&
    s0 === ((c4 / 13) | 0);

  let mask = 0;
  let unique = 0;
  for (let r = 0; r < 13; r++) {
    if (COUNTS[r]) {
      mask |= 1 << r;
      unique++;
    }
  }

  let straightHigh = -1;
  if (unique === 5) {
    for (let hi = 12; hi >= 4; hi--) {
      if (((mask >> (hi - 4)) & 31) === 31) {
        straightHigh = hi;
        break;
      }
    }
    if (straightHigh < 0 && mask === ((1 << 12) | 1 | 2 | 4 | 8)) straightHigh = 3;
  }

  if (flush && straightHigh >= 0) return pack(8, straightHigh);

  let quad = -1;
  let trip = -1;
  let pair1 = -1;
  let pair2 = -1;
  let k0 = 0;
  let k1 = 0;
  let k2 = 0;
  let k3 = 0;
  let k4 = 0;
  let kn = 0;
  for (let r = 12; r >= 0; r--) {
    const count = COUNTS[r];
    if (count === 4) quad = r;
    else if (count === 3) trip = r;
    else if (count === 2) {
      if (pair1 < 0) pair1 = r;
      else pair2 = r;
    } else if (count === 1) {
      if (kn === 0) k0 = r;
      else if (kn === 1) k1 = r;
      else if (kn === 2) k2 = r;
      else if (kn === 3) k3 = r;
      else k4 = r;
      kn++;
    }
  }

  if (quad >= 0) return pack(7, quad, k0);
  if (trip >= 0 && pair1 >= 0) return pack(6, trip, pair1);
  if (flush) return flushScore(r0, r1, r2, r3, r4);
  if (straightHigh >= 0) return pack(4, straightHigh);
  if (trip >= 0) return pack(3, trip, k0, k1);
  if (pair1 >= 0 && pair2 >= 0) return pack(2, pair1, pair2, k0);
  if (pair1 >= 0) return pack(1, pair1, k0, k1, k2);
  return pack(0, k0, k1, k2, k3, k4);
}

export function evaluateCards(cards: readonly number[]): number {
  const n = cards.length;
  if (n < 5) return 0;
  if (n === 5) return evaluate5(cards[0], cards[1], cards[2], cards[3], cards[4]);
  const combos = n === 6 ? C65 : C75;
  let best = -1;
  for (let i = 0; i < combos.length; i++) {
    const ix = combos[i];
    const score = evaluate5(cards[ix[0]], cards[ix[1]], cards[ix[2]], cards[ix[3]], cards[ix[4]]);
    if (score > best) best = score;
  }
  return best;
}

export function categoryOf(score: number): number {
  return score >>> 20;
}

export function topKicker(score: number): number {
  return (score >>> 16) & 15;
}

const RANK_CHARS = "23456789TJQKA";
const SUIT_CHARS = ["♠", "♥", "♦", "♣"];

export function cardText(card: number): { rank: string; suit: string; red: boolean } {
  const rank = card % 13;
  const suit = (card / 13) | 0;
  return {
    rank: RANK_CHARS[rank],
    suit: SUIT_CHARS[suit],
    red: suit === 1 || suit === 2,
  };
}

export function cardCode(rank: number, suit: number): number {
  return rank + suit * 13;
}

/** Percentile 0–1 over the 169 starting-hand classes. 1 is the best hand. */
const STRENGTH = new Float64Array(13 * 13 * 2);

function handKey(hi: number, lo: number, suited: boolean): number {
  return (hi * 13 + lo) * 2 + (hi === lo ? 0 : suited ? 1 : 0);
}

(function buildStrength() {
  const items: { key: number; score: number }[] = [];
  for (let hi = 0; hi < 13; hi++) {
    for (let lo = 0; lo <= hi; lo++) {
      const suitedFlags = hi === lo ? [false] : [false, true];
      for (const suited of suitedFlags) {
        let score = hi * 4 + lo;
        if (hi === lo) score += 40;
        if (suited) score += 6;
        const gap = hi - lo;
        if (hi !== lo && gap === 1) score += 3;
        else if (hi !== lo && gap === 2) score += 1;
        if (hi === 12 && lo >= 8) score += 8;
        if (hi === 12 && lo >= 11) score += 4;
        items.push({ key: handKey(hi, lo, suited), score });
      }
    }
  }
  items.sort((a, b) => a.score - b.score || a.key - b.key);
  const last = items.length - 1;
  for (let i = 0; i < items.length; i++) STRENGTH[items[i].key] = i / last;
})();

export function handStrength(c0: number, c1: number): number {
  let r0 = c0 % 13;
  let r1 = c1 % 13;
  const suited = ((c0 / 13) | 0) === ((c1 / 13) | 0);
  if (r0 < r1) {
    const t = r0;
    r0 = r1;
    r1 = t;
  }
  return STRENGTH[handKey(r0, r1, suited)];
}

export function roughEquity(c0: number, c1: number, board: readonly number[]): number {
  const n = 2 + board.length;
  const cards = new Array<number>(n);
  cards[0] = c0;
  cards[1] = c1;
  for (let i = 0; i < board.length; i++) cards[i + 2] = board[i];
  const score = evaluateCards(cards);
  const cat = categoryOf(score);
  if (cat >= 8) return 0.98;
  if (cat === 7) return 0.95;
  if (cat === 6) return 0.9;
  if (cat === 5) return 0.83;
  if (cat === 4) return 0.78;
  if (cat === 3) return 0.72;
  if (cat === 2) return 0.63;
  let maxBoard = 0;
  for (let i = 0; i < board.length; i++) maxBoard = Math.max(maxBoard, board[i] % 13);
  if (cat === 1) {
    const pairRank = topKicker(score);
    const h0 = c0 % 13;
    const h1 = c1 % 13;
    if (h0 === h1 && h0 > maxBoard) return 0.7;
    if (pairRank === maxBoard && (h0 === maxBoard || h1 === maxBoard)) {
      const kicker = (score >>> 12) & 15;
      if (kicker >= 11) return 0.62;
      if (kicker >= 8) return 0.55;
      return 0.5;
    }
    if (pairRank + 1 >= maxBoard) return 0.4;
    return 0.31;
  }

  let equity = 0.15;
  const suits = [0, 0, 0, 0];
  const holeSuits = [0, 0, 0, 0];
  holeSuits[(c0 / 13) | 0]++;
  holeSuits[(c1 / 13) | 0]++;
  for (let i = 0; i < n; i++) suits[(cards[i] / 13) | 0]++;
  let flushDraw = false;
  for (let s = 0; s < 4; s++) {
    if (suits[s] >= 4 && holeSuits[s] > 0 && cat < 5) flushDraw = true;
  }
  const onFlop = board.length === 3;
  if (flushDraw && suits.some((c) => c === 4)) equity += onFlop ? 0.17 : 0.08;

  const present = new Uint8Array(13);
  for (let i = 0; i < n; i++) present[cards[i] % 13] = 1;
  let run = 0;
  let oesd = false;
  for (let r = 0; r < 13; r++) {
    if (present[r]) run++;
    else {
      if (run >= 4) oesd = true;
      run = 0;
    }
  }
  if (run >= 4) oesd = true;
  let gut = false;
  if (!oesd) {
    for (let start = 0; start <= 8; start++) {
      let have = 0;
      for (let k = 0; k < 5; k++) if (present[start + k]) have++;
      if (have === 4) gut = true;
    }
    let wheel = 0;
    if (present[12]) wheel++;
    for (let r = 0; r <= 3; r++) if (present[r]) wheel++;
    if (wheel === 4) gut = true;
  }
  if (oesd) equity += onFlop ? 0.15 : 0.08;
  else if (gut) equity += onFlop ? 0.08 : 0.04;
  if (c0 % 13 > maxBoard) equity += 0.04;
  if (c1 % 13 > maxBoard) equity += 0.04;
  return Math.min(0.58, equity);
}
