import { ELO_DIVISOR, ELO_K } from "./constants";

/** Place 1 scores 1, last place scores 0. Ties split the average of the tied places. */
export function placementScores(nets: readonly number[]): number[] {
  const n = nets.length;
  const order = nets.map((net, index) => ({ net, index }));
  order.sort((a, b) => b.net - a.net || a.index - b.index);
  const scores = new Array<number>(n).fill(0);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && order[j + 1].net === order[i].net) j++;
    let sum = 0;
    for (let p = i; p <= j; p++) sum += (n - (p + 1)) / (n - 1);
    const avg = sum / (j - i + 1);
    for (let k = i; k <= j; k++) scores[order[k].index] = avg;
    i = j + 1;
  }
  return scores;
}

export function expectedScore(ratings: readonly number[], index: number): number {
  const n = ratings.length;
  let sum = 0;
  const mine = ratings[index];
  for (let j = 0; j < n; j++) {
    if (j === index) continue;
    sum += 1 / (1 + 10 ** ((ratings[j] - mine) / ELO_DIVISOR));
  }
  return sum / (n - 1);
}

export function eloUpdates(ratings: readonly number[], scores: readonly number[]): number[] {
  return ratings.map((rating, i) => rating + ELO_K * (scores[i] - expectedScore(ratings, i)));
}
