import { BIG_BLIND } from "./constants";
import type { Tier } from "./constants";
import { handStrength, roughEquity } from "./eval";
import type { Ctx, Decision } from "./hand";

export interface BotParams {
  open: number[];
  call: number[];
  threeBet: number[];
  shoveCall: number;
  valueEdge: number;
  betEdge: number;
  bluff: number;
  agg: number;
  posSens: number;
  adapt: number;
  eloTight: number;
  eloAgg: number;
  personality: string;
}

export interface BotMemory {
  hands: number;
  showdowns: number;
  shovesFaced: number;
  foldsToShove: number;
  aggSeen: number;
  passiveSeen: number;
  openShift: number;
  callShift: number;
  bluffShift: number;
  betShift: number;
}

export interface Bot {
  id: string;
  name: string;
  tier: Tier;
  team: number;
  elo: number;
  matches: number;
  params: BotParams;
  memory: BotMemory;
}

export function emptyMemory(): BotMemory {
  return {
    hands: 0,
    showdowns: 0,
    shovesFaced: 0,
    foldsToShove: 0,
    aggSeen: 0,
    passiveSeen: 0,
    openShift: 0,
    callShift: 0,
    bluffShift: 0,
    betShift: 0,
  };
}

function clamp(value: number, lo: number, hi: number): number {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

export interface HandObs {
  showdown: boolean;
  facedShove: boolean;
  foldedToShove: boolean;
  agg: number;
  passive: number;
}

export function learnFromHand(bot: Bot, obs: HandObs): void {
  if (bot.tier !== "agentic") return;
  const memory = bot.memory;
  const speed = bot.params.adapt;
  memory.hands++;
  if (obs.showdown) memory.showdowns++;
  if (obs.facedShove) {
    memory.shovesFaced++;
    if (obs.foldedToShove) memory.foldsToShove++;
  }
  memory.aggSeen += obs.agg;
  memory.passiveSeen += obs.passive;
  const showdownRate = memory.showdowns / memory.hands;
  const foldToShove = memory.shovesFaced > 0 ? memory.foldsToShove / memory.shovesFaced : 0.45;
  const aggression =
    memory.aggSeen + memory.passiveSeen > 0 ? memory.aggSeen / (memory.aggSeen + memory.passiveSeen) : 0.35;
  memory.bluffShift = clamp(memory.bluffShift + speed * (foldToShove - 0.45) * 0.05, -0.2, 0.28);
  memory.openShift = clamp(memory.openShift + speed * (showdownRate - 0.3) * 0.04, -0.16, 0.2);
  memory.betShift = clamp(memory.betShift + speed * (showdownRate - 0.3) * 0.03, -0.12, 0.16);
  memory.callShift = clamp(memory.callShift + speed * (aggression - 0.4) * 0.04, -0.16, 0.2);
}

export function decideBot(bot: Bot, ctx: Ctx, rng: () => number): Decision {
  const params = bot.params;
  const memory = bot.memory;
  let tight = memory.openShift;
  let callShift = memory.callShift;
  let bluffShift = memory.bluffShift;
  let betShift = memory.betShift;
  let agg = params.agg;
  if (bot.tier === "dynamic") {
    const edge = (ctx.ownElo - ctx.oppAvgElo) / 400;
    tight += clamp(edge * params.eloTight, -0.24, 0.24);
    agg = clamp(params.agg + edge * params.eloAgg, 0.45, 2.1);
  } else if (bot.tier !== "agentic") {
    tight = 0;
    callShift = 0;
    bluffShift = 0;
    betShift = 0;
  }
  const pos = ctx.pos < params.open.length ? ctx.pos : params.open.length - 1;
  const late = pos === 0 || pos === 5 ? 1 : pos === 4 ? 0.45 : 0;
  const looser = params.posSens * late * 0.07;

  if (ctx.street === 0) {
    const strength = handStrength(ctx.hole0, ctx.hole1);
    const shoveLine = clamp(params.shoveCall + tight * 0.45 + callShift, 0.05, 0.98);
    if (ctx.facingShove || ctx.toCall >= ctx.stack) {
      if (strength >= shoveLine && ctx.canCall) return { act: "call" };
      if (strength >= shoveLine && ctx.canRaise) return { act: "allin" };
      return { act: "fold" };
    }
    if (ctx.toCall === 0) {
      const openLine = clamp(params.open[pos] + tight - looser, 0.04, 0.98);
      if (strength >= openLine && ctx.canBet) {
        const openTo = Math.min(ctx.maxTo, Math.round(BIG_BLIND * (2.15 + agg)));
        if (openTo >= ctx.maxTo * 0.9) return { act: "allin" };
        return { act: "bet", to: Math.max(ctx.minBetTo, openTo) };
      }
      return { act: "check" };
    }
    const threeLine = clamp(params.threeBet[pos] + tight * 0.8 - looser * 0.4, 0.08, 0.99);
    const callLine = clamp(params.call[pos] + tight * 0.7 + callShift - looser * 0.35, 0.04, 0.98);
    if (strength >= threeLine && ctx.canRaise) {
      const target = Math.min(ctx.maxTo, Math.max(ctx.minRaiseTo, Math.round(ctx.currentBet * (2.5 + agg * 0.35))));
      if (target >= ctx.maxTo * 0.88) return { act: "allin" };
      return { act: "raise", to: target };
    }
    if (strength >= callLine && ctx.canCall) return { act: "call" };
    return { act: "fold" };
  }

  const equity = roughEquity(ctx.hole0, ctx.hole1, ctx.board);
  const odds = ctx.toCall > 0 ? ctx.toCall / (ctx.pot + ctx.toCall) : 0;
  const betLine = clamp(params.betEdge + tight * 0.25 + betShift - looser, 0.2, 0.92);
  const continueEdge = params.valueEdge + callShift * 0.25;
  if (ctx.facingShove || (ctx.toCall > 0 && ctx.toCall >= ctx.stack)) {
    if (equity >= Math.max(odds, 0.4) + continueEdge - 0.08 && ctx.canCall) return { act: "call" };
    return ctx.toCall === 0 ? { act: "check" } : { act: "fold" };
  }
  if (ctx.toCall === 0) {
    const bluff = rng() < clamp(params.bluff + bluffShift + looser * 0.4, 0, 0.55);
    if ((equity >= betLine || bluff) && ctx.canBet) {
      const frac = bluff && equity < betLine ? 0.55 : 0.6 + (agg - 1) * 0.18;
      let target = ctx.streetPut + Math.max(BIG_BLIND, Math.round(Math.max(ctx.pot, BIG_BLIND) * frac));
      if (equity >= 0.88 || target >= ctx.maxTo * 0.82) return { act: "allin" };
      if (target < ctx.minBetTo) target = ctx.minBetTo;
      if (target > ctx.maxTo) target = ctx.maxTo;
      return { act: "bet", to: target };
    }
    return { act: "check" };
  }
  if (equity >= 0.84 && ctx.canRaise) {
    const target = Math.min(
      ctx.maxTo,
      Math.max(ctx.minRaiseTo, ctx.currentBet + Math.round(Math.max(ctx.pot, BIG_BLIND) * (0.75 + agg * 0.2))),
    );
    if (equity >= 0.92 || target >= ctx.maxTo * 0.78) return { act: "allin" };
    return { act: "raise", to: target };
  }
  if (equity + 0.015 >= odds + continueEdge && ctx.canCall) return { act: "call" };
  if (rng() < clamp(params.bluff + bluffShift, 0, 0.5) * 0.2 && ctx.canRaise && equity > 0.3) {
    const target = Math.min(ctx.maxTo, Math.max(ctx.minRaiseTo, Math.round(ctx.currentBet * (2 + agg * 0.25))));
    return { act: "raise", to: target };
  }
  return { act: "fold" };
}
