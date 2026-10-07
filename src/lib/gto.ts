import table from "./gto-strategy.json";
import { BIG_BLIND } from "./constants";
import type { Ctx, Decision } from "./hand";

/**
 * GTO-style decisions from a Discounted CFR blueprint.
 * The numbers are solved by b-inary/postflop-solver (heads-up, button vs big blind,
 * 66% pot bets). See solver/README.md. This file only looks them up.
 */

interface FlopSpot {
  board: string;
  high: number;
  mid: number;
  low: number;
  paired: number;
  suits: number;
  span: number;
  exploitability: number;
  nodes: Record<string, string>;
}

const spots = table.flops as FlopSpot[];
const inRange = table.inRange as Record<string, number[]>;
const decoded = new Map<string, Uint8Array>();

function decode(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

for (const spot of spots) {
  for (const [name, b64] of Object.entries(spot.nodes)) {
    decoded.set(`${spot.board}|${name}`, decode(b64));
  }
}

/** 0–168 over the 169 starting-hand classes. Pairs are 0–12 (deuces through aces). */
export function class169(c0: number, c1: number): number {
  let r0 = c0 % 13;
  let r1 = c1 % 13;
  const suited = ((c0 / 13) | 0) === ((c1 / 13) | 0);
  if (r0 < r1) {
    const swap = r0;
    r0 = r1;
    r1 = swap;
  }
  if (r0 === r1) return r0;
  const combo = (r0 * (r0 - 1)) / 2 + r1;
  return suited ? 13 + combo : 13 + 78 + combo;
}

function rankOf(card: number): number {
  return card % 13;
}

function suitKinds(cards: readonly number[]): number {
  let seen = 0;
  for (const card of cards) seen |= 1 << ((card / 13) | 0);
  let count = 0;
  for (let suit = 0; suit < 4; suit++) if (seen & (1 << suit)) count++;
  return count;
}

/** 3 flush, 2 pair, 4 straightening, 1 overcard, 0 blank. Matches the solver export. */
export function streetTexture(before: readonly number[], card: number): number {
  const ranks = new Uint8Array(13);
  const suits = new Uint8Array(4);
  for (const previous of before) {
    ranks[previous % 13]++;
    suits[(previous / 13) | 0]++;
  }
  const cr = card % 13;
  const cs = (card / 13) | 0;
  if (suits[cs] >= 2) return 3;
  if (ranks[cr] >= 1) return 2;
  let near = 0;
  for (let rank = 0; rank < 13; rank++) {
    if (ranks[rank] > 0 && rank !== cr && Math.abs(rank - cr) <= 4) near++;
  }
  if (near >= 2) return 4;
  let maxBoard = 0;
  for (let rank = 12; rank >= 0; rank--) {
    if (ranks[rank] > 0) {
      maxBoard = rank;
      break;
    }
  }
  return cr > maxBoard ? 1 : 0;
}

function flopDistance(spot: FlopSpot, cards: readonly number[]): number {
  const ranks = [rankOf(cards[0]), rankOf(cards[1]), rankOf(cards[2])].sort((a, b) => b - a);
  const counts = new Uint8Array(13);
  for (const rank of ranks) counts[rank]++;
  const paired = counts.some((count) => count >= 2) ? 1 : 0;
  const suits = suitKinds(cards);
  return (
    Math.abs(spot.high - ranks[0]) * 2 +
    Math.abs(spot.mid - ranks[1]) +
    Math.abs(spot.low - ranks[2]) +
    Math.abs(spot.span - (ranks[0] - ranks[2])) +
    Math.abs(spot.paired - paired) * 4 +
    Math.abs(spot.suits - suits) * 3
  );
}

function nearestFlop(cards: readonly number[]): FlopSpot {
  let best = spots[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const spot of spots) {
    const distance = flopDistance(spot, cards);
    if (distance < bestDistance) {
      best = spot;
      bestDistance = distance;
    }
  }
  return best;
}

function row(bytes: Uint8Array, hand: number): Uint8Array | null {
  const start = hand * 4;
  const slice = bytes.subarray(start, start + 4);
  const total = slice[0] + slice[1] + slice[2] + slice[3];
  return total > 0 ? slice : null;
}

function mixFor(ctx: Ctx): Uint8Array | null {
  if (ctx.board.length < 3) return null;
  const spot = nearestFlop(ctx.board);
  const hand = class169(ctx.hole0, ctx.hole1);
  const facing = ctx.toCall > 0;
  const sawBet = ctx.line.includes("b") || ctx.line.includes("a");
  let key = "F";
  if (ctx.street === 1) {
    if (facing) key = "Fb";
    else if (ctx.pos === 0 && ctx.line.includes("x")) key = "Fx";
    else key = "F";
  } else if (ctx.street === 2) {
    const kind = streetTexture(ctx.board.slice(0, 3), ctx.board[3]);
    key = facing ? `Tb${kind}` : sawBet ? `Td${kind}` : `T${kind}`;
  } else if (ctx.street >= 3) {
    const kind = streetTexture(ctx.board.slice(0, 4), ctx.board[4]);
    key = facing ? `Rb${kind}` : `R${kind}`;
  }
  const exact = decoded.get(`${spot.board}|${key}`);
  const found = exact ? row(exact, hand) : null;
  if (found) return found;
  const fallback = decoded.get(`${spot.board}|${ctx.street === 1 ? "F" : ctx.street === 2 ? "T0" : "R0"}`);
  return fallback ? row(fallback, hand) : null;
}

/** Fold, check/call, bet, all-in. Null when this hand was not in the solved range. */
export function solverFrequencies(ctx: Ctx): number[] | null {
  const mix = mixFor(ctx);
  if (!mix) return null;
  const total = mix[0] + mix[1] + mix[2] + mix[3];
  return [mix[0] / total, mix[1] / total, mix[2] / total, mix[3] / total];
}

function sample(mix: Uint8Array, rng: () => number): number {
  const total = mix[0] + mix[1] + mix[2] + mix[3];
  let ticket = rng() * total;
  for (let action = 0; action < 4; action++) {
    ticket -= mix[action];
    if (ticket < 0) return action;
  }
  return 3;
}

function has(name: string, hand: number): boolean {
  const flags = inRange[name];
  return !!flags && flags[hand] === 1;
}

function openRange(pos: number, n: number): string {
  if (n <= 2) return pos === 0 ? "ip" : "oop";
  if (pos === 3) return "utg";
  if (pos === 4) return "hj";
  return "ip";
}

function raiseTo(ctx: Ctx, target: number, allIn: boolean): Decision {
  if (allIn || target >= ctx.maxTo * 0.9) return { act: "allin" };
  if (ctx.toCall <= 0 && ctx.canBet) {
    const to = Math.min(ctx.maxTo, Math.max(ctx.minBetTo, target));
    return { act: "bet", to };
  }
  if (ctx.canRaise) {
    const to = Math.min(ctx.maxTo, Math.max(ctx.minRaiseTo, target));
    return { act: "raise", to };
  }
  if (ctx.canCall) return { act: "call" };
  if (ctx.canCheck) return { act: "check" };
  return { act: "fold" };
}

function preflop(ctx: Ctx): Decision {
  const hand = class169(ctx.hole0, ctx.hole1);
  let raises = 0;
  for (const code of ctx.line) if (code === "b" || code === "a") raises++;
  if (ctx.n > 2 && ctx.pos === 2 && ctx.toCall <= 0 && raises === 0) return { act: "check" };
  if (raises === 0) {
    if (ctx.toCall <= 0) return { act: "check" };
    if (!has(openRange(ctx.pos, ctx.n), hand)) return ctx.canFold ? { act: "fold" } : { act: "check" };
    return raiseTo(ctx, Math.round(table.openToBb * BIG_BLIND), false);
  }
  if (raises === 1) {
    if (has("three", hand)) return raiseTo(ctx, Math.round(ctx.currentBet * table.raiseMultiple), false);
    if (has("oop", hand)) return ctx.canCall ? { act: "call" } : ctx.canCheck ? { act: "check" } : { act: "fold" };
    return ctx.canFold ? { act: "fold" } : { act: "check" };
  }
  if (has("three", hand)) {
    if (ctx.toCall >= ctx.stack * 0.35) return ctx.canCall ? { act: "call" } : { act: "allin" };
    return raiseTo(ctx, ctx.maxTo, true);
  }
  return ctx.canFold ? { act: "fold" } : { act: "check" };
}

function fromMix(ctx: Ctx, action: number): Decision {
  if (action === 0) {
    if (ctx.canFold) return { act: "fold" };
    if (ctx.canCheck) return { act: "check" };
    return { act: "fold" };
  }
  if (action === 1) {
    if (ctx.canCheck) return { act: "check" };
    if (ctx.canCall) return { act: "call" };
    if (ctx.canFold) return { act: "fold" };
    return { act: "check" };
  }
  if (action === 3) return { act: "allin" };
  const pot = Math.max(ctx.pot, BIG_BLIND);
  if (ctx.toCall <= 0) {
    const add = Math.max(BIG_BLIND, Math.round(pot * table.betPot));
    return raiseTo(ctx, ctx.streetPut + add, false);
  }
  return raiseTo(ctx, Math.round(ctx.currentBet * table.raiseMultiple), false);
}

/** One decision for a GTO-style bot. Postflop mixes come from the solved tree. */
export function decideSolver(ctx: Ctx, rng: () => number): Decision {
  if (ctx.street === 0 || ctx.board.length < 3) return preflop(ctx);
  const mix = mixFor(ctx);
  if (!mix) {
    if (ctx.toCall <= 0 && ctx.canCheck) return { act: "check" };
    return ctx.canFold ? { act: "fold" } : { act: "check" };
  }
  return fromMix(ctx, sample(mix, rng));
}
