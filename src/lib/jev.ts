import { roughEquity } from "./eval";
import { positionName, type Act, type Decision, type HandMachine, type Legal } from "./hand";

const SUIT = "shdc";
const STREETS = ["Preflop", "Flop", "Turn", "River"];

export interface JevSpot {
  toCall: number;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  canBet: boolean;
  canRaise: boolean;
  minBetTo: number;
  minRaiseTo: number;
  maxTo: number;
  pot: number;
  streetPut: number;
}

/** Public table facts. Other hole cards stay out. */
export function jevState(hand: HandMachine, seat: number, names: readonly string[]): Record<string, unknown> {
  const legal = hand.legal(seat);
  const hole = hand.hole[seat] ?? [];
  const board = hand.board.filter((card) => card >= 0);
  const pot = hand.pot;
  const toCall = legal.toCall;
  let equity = 0;
  if (hole.length >= 2) {
    try {
      equity = roughEquity(hole[0], hole[1], board);
    } catch {
      equity = 0;
    }
  }
  const seats = [];
  for (let i = 0; i < hand.n; i++) {
    seats.push({
      seat: i,
      name: names[i] || `Seat ${i}`,
      position: positionName(seatPos(hand, i), hand.n),
      stack: hand.stack[i],
      committed: hand.streetPut[i],
      folded: hand.folded[i],
      allIn: hand.allin[i],
      hero: i === seat,
    });
  }
  return {
    game: hand.n === 2 ? "heads-up no-limit hold'em" : "six-max no-limit hold'em",
    blinds: hand.blinds ? "50 small blind, 100 big blind" : "no forced blinds, minimum opening bet 100",
    street: STREETS[hand.street] ?? "Showdown",
    buttonSeat: hand.button,
    pot,
    currentBet: hand.currentBet,
    hero: {
      seat,
      name: names[seat] || "Hero",
      position: positionName(seatPos(hand, seat), hand.n),
      hole: hole.map(cardName),
      stack: hand.stack[seat],
      committed: hand.streetPut[seat],
      toCall,
    },
    board: board.map(cardName),
    seats,
    actionLog: hand.log.slice(-24),
    streetLine: hand.line,
    potOdds: toCall > 0 ? Number((toCall / (pot + toCall)).toFixed(3)) : 0,
    stackToPot: Number((hand.stack[seat] / Math.max(pot, 1)).toFixed(2)),
    sketchEquity: Number(equity.toFixed(3)),
    sketchNote: "sketchEquity is a local hand-rank sketch, not a solver. Judge the cards yourself.",
    legal: legalWords(legal),
    limits: {
      minBetTo: legal.minBetTo,
      minRaiseTo: legal.minRaiseTo,
      maxTo: legal.maxTo,
    },
    hidden: "Every other hole card is unknown. Do not invent them.",
  };
}

export function jevQuestions(legal: Legal): Record<string, unknown> {
  const criteria: Record<string, string> = {};
  if (legal.canFold) criteria.fold = "Give up the hand.";
  if (legal.canCheck) criteria.check = "Decline to bet.";
  if (legal.canCall) criteria.call = "Match the current bet.";
  if (legal.canBet) criteria.bet = "Open the betting.";
  if (legal.canRaise) criteria.raise = "Raise the current bet.";
  criteria.allin = "Move all remaining chips in.";
  const questions: Record<string, unknown> = {
    action: {
      type: "choice",
      instructions:
        "Choose hero's next action from the public state. Other hole cards are unknown. Play sound no-limit poker.",
      criteria,
    },
  };
  if (legal.canBet || legal.canRaise) {
    questions.size = {
      type: "choice",
      instructions: "If the action is a bet or a raise, pick the size. Ignore this for a check, call, or fold.",
      criteria: {
        min: "The smallest legal bet or raise.",
        half: "About half the pot.",
        pot: "About the size of the pot.",
        two: "About twice the pot.",
        shove: "All remaining chips.",
      },
    };
  }
  return questions;
}

export function decisionFromJev(spot: JevSpot, answers: { action?: { choice?: string }; size?: { choice?: string } }): Decision {
  const raw = String(answers.action?.choice ?? "").toLowerCase();
  let act: Act = spot.canCheck ? "check" : spot.canCall ? "call" : "fold";
  if (raw === "fold" || raw === "check" || raw === "call" || raw === "bet" || raw === "raise" || raw === "allin") act = raw;
  if (act === "fold" && !spot.canFold) act = spot.canCheck ? "check" : spot.canCall ? "call" : "fold";
  if (act === "check" && !spot.canCheck) act = spot.canCall ? "call" : spot.canFold ? "fold" : "check";
  if (act === "call" && !spot.canCall) act = spot.canCheck ? "check" : "fold";
  if (act === "bet" && !spot.canBet) act = spot.canRaise ? "raise" : spot.canCheck ? "check" : "call";
  if (act === "raise" && !spot.canRaise) act = spot.canBet ? "bet" : spot.canCall ? "call" : "check";
  if (act === "allin") return { act: "allin" };
  if (act !== "bet" && act !== "raise") return { act };
  const size = String(answers.size?.choice ?? "pot").toLowerCase();
  if (size === "shove") return { act: "allin" };
  const min = act === "bet" ? spot.minBetTo : spot.minRaiseTo;
  const add = size === "min" ? 0 : size === "half" ? spot.pot * 0.5 : size === "two" ? spot.pot * 2 : spot.pot;
  let to = size === "min" ? min : Math.round(spot.streetPut + add);
  if (to >= spot.maxTo) return { act: "allin" };
  if (to < min) to = min;
  return { act, to };
}

export function jevReady(): Promise<boolean> {
  return fetch(jevUrl(), { method: "GET", headers: { Accept: "application/json" } })
    .then(async (res) => {
      if (!res.ok) return false;
      const body = (await res.json()) as { ready?: boolean };
      return body.ready === true;
    })
    .catch(() => false);
}

/** Ask the local table server. The browser never sends a key. */
export async function askJev(
  hand: HandMachine,
  seat: number,
  names: readonly string[],
): Promise<{ decision: Decision; note: string }> {
  const legal = hand.legal(seat);
  const spot: JevSpot = {
    toCall: legal.toCall,
    canFold: legal.canFold,
    canCheck: legal.canCheck,
    canCall: legal.canCall,
    canBet: legal.canBet,
    canRaise: legal.canRaise,
    minBetTo: legal.minBetTo,
    minRaiseTo: legal.minRaiseTo,
    maxTo: legal.maxTo,
    pot: hand.pot,
    streetPut: hand.streetPut[seat] ?? 0,
  };
  const fallback = (): Decision => (spot.canCheck ? { act: "check" } : spot.canFold ? { act: "fold" } : { act: "call" });
  const note = spot.canCheck ? "Jev did not answer. Checked." : "Jev did not answer. Folded.";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(jevUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ state: jevState(hand, seat, names), questions: jevQuestions(legal) }),
      signal: controller.signal,
    });
    if (!res.ok) return { decision: fallback(), note };
    const body = (await res.json()) as { answers?: { action?: { choice?: string }; size?: { choice?: string } } };
    return { decision: decisionFromJev(spot, body.answers ?? {}), note: "" };
  } catch {
    return { decision: fallback(), note };
  } finally {
    clearTimeout(timer);
  }
}

function jevUrl(): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
  return `${base}/api/jev/`;
}

function seatPos(hand: HandMachine, seat: number): number {
  return (seat - hand.button + hand.n) % hand.n;
}

function cardName(card: number): string {
  const ranks = "23456789TJQKA";
  const rank = card % 13;
  const suit = (card / 13) | 0;
  return `${ranks[rank] ?? "?"}${SUIT[suit] ?? "?"}`;
}

function legalWords(legal: Legal): string[] {
  const words: string[] = [];
  if (legal.canFold) words.push("fold");
  if (legal.canCheck) words.push("check");
  if (legal.canCall) words.push("call");
  if (legal.canBet) words.push("bet");
  if (legal.canRaise) words.push("raise");
  words.push("allin");
  return words;
}
