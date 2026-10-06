import { categoryOf, evaluateCards, topKicker } from "./eval";
import type { Decision } from "./hand";

/** Any pocket pair, plus AK / AQ / AJ / AT suited or offsuit. */
export function kaijiPreflopShove(c0: number, c1: number): boolean {
  const r0 = c0 % 13;
  const r1 = c1 % 13;
  if (r0 === r1) return true;
  const hi = r0 > r1 ? r0 : r1;
  const lo = r0 > r1 ? r1 : r0;
  return hi === 12 && lo >= 8;
}

/**
 * Shove with top pair or better. Top pair and overpair require a hole card in the pair.
 * Two pair, trips, straights, flushes, and better always shove, including board-made hands.
 */
export function kaijiPostflopShove(c0: number, c1: number, board: readonly number[]): boolean {
  if (board.length < 3) return false;
  const cards = [c0, c1, board[0], board[1], board[2]];
  for (let i = 3; i < board.length; i++) cards.push(board[i]);
  const score = evaluateCards(cards);
  const category = categoryOf(score);
  if (category >= 2) return true;
  if (category !== 1) return false;
  const pairRank = topKicker(score);
  let maxBoard = 0;
  for (let i = 0; i < board.length; i++) {
    const rank = board[i] % 13;
    if (rank > maxBoard) maxBoard = rank;
  }
  const h0 = c0 % 13;
  const h1 = c1 % 13;
  if (h0 === h1 && h0 > maxBoard) return true;
  return pairRank === maxBoard && (h0 === maxBoard || h1 === maxBoard);
}

export function kaijiDecision(
  c0: number,
  c1: number,
  board: readonly number[],
  street: number,
  toCall: number,
): Decision {
  const shove = street === 0 ? kaijiPreflopShove(c0, c1) : kaijiPostflopShove(c0, c1, board);
  if (shove) return { act: "allin" };
  if (toCall === 0) return { act: "check" };
  return { act: "fold" };
}
