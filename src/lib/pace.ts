import { DEFAULT_TEAMS, HANDS_PER_MATCH, INITIAL_ELO } from "./constants";
import { applyKaijiPopulation, generateField } from "./field";
import { HandMachine, type Ctx, type Decision } from "./hand";
import { kaijiDecision } from "./kaiji";
import { drawRound, playTableHand, rateTable, type SeatCard } from "./match";
import { decideBot } from "./policy";
import { Rng, hashString } from "./rng";

/** Hard ceiling. The slider never claims a faster pace than a measured run. */
export const ABSOLUTE_SPEED_CAP = 100_000_000;
/** Work slice. The event loop gets a turn after each one so the tab can paint. */
export const FRAME_BUDGET_MS = 12;
export const BENCH_MS = 4_000;

/** Delays the 1× watcher inserts between paints. SimController.stepWatch uses these. */
export const WATCH_DEAL_MS = 360;
export const WATCH_ACTION_MS = 460;
export const WATCH_LAST_ACTION_MS = 200;
export const WATCH_STREET_MS = 420;
export const WATCH_LAST_STREET_MS = 700;
export const WATCH_SHOW_MS = 880;
export const WATCH_HOLD_MS = 420;

export interface PaceReport {
  /** Highest multiplier the machine held, already capped. */
  maxSpeed: number;
  /** Unthrottled room hands per second, including every seated bot. */
  handsPerSec: number;
  /** Hands per second of the 1× watcher, animation delays plus the same CPU. */
  oneXHandsPerSec: number;
  scheduledMsPerHand: number;
  players: number;
  blinds: boolean;
}

export function formatSpeed(speed: number): string {
  return `${Math.round(speed).toLocaleString("en-US")}×`;
}

export function formatHandsPerSec(handsPerSec: number): string {
  if (!Number.isFinite(handsPerSec) || handsPerSec < 0) return "—";
  if (handsPerSec < 10) return `${handsPerSec.toFixed(1)} hands/s`;
  return `${Math.round(handsPerSec).toLocaleString("en-US")} hands/s`;
}

/** Logarithmic slider position, 0 at 1× and 1000 at the measured maximum. */
export function sliderPosition(speed: number, maxSpeed: number): number {
  if (maxSpeed <= 1 || speed <= 1) return 0;
  const t = Math.log(Math.min(speed, maxSpeed)) / Math.log(maxSpeed);
  return Math.round(Math.min(1, Math.max(0, t)) * 1000);
}

export function speedFromPosition(position: number, maxSpeed: number): number {
  if (maxSpeed <= 1 || position <= 0) return 1;
  if (position >= 1000) return maxSpeed;
  const t = Math.min(1, Math.max(0, position / 1000));
  return Math.max(1, Math.min(maxSpeed, Math.round(Math.exp(Math.log(maxSpeed) * t))));
}

/** Presets that exist inside the measured range. Nothing above the bench is listed. */
export function speedPresets(maxSpeed: number): number[] {
  const cap = Math.max(1, Math.round(maxSpeed));
  const speeds = new Set<number>();
  for (const speed of [1, 10, 100, 1000, cap]) {
    if (speed >= 1 && speed <= cap) speeds.add(speed);
  }
  return [...speeds].sort((a, b) => a - b);
}

/**
 * Multiplier of an unthrottled room against the 1× watcher.
 * 1× spends the animation delays plus one hand of the same CPU.
 */
export function multiplierFromPace(handsPerSec: number, scheduledMsPerHand: number): number {
  const perHand = oneXRate(handsPerSec, scheduledMsPerHand);
  const raw = perHand > 0 ? handsPerSec / perHand : 1;
  if (!Number.isFinite(raw) || raw < 1) return 1;
  return Math.min(ABSOLUTE_SPEED_CAP, Math.round(raw));
}

export function oneXRate(handsPerSec: number, scheduledMsPerHand: number): number {
  if (!(scheduledMsPerHand > 0)) return 0;
  const cpuMs = handsPerSec > 0 ? 1000 / handsPerSec : 0;
  const oneXMs = scheduledMsPerHand + cpuMs;
  return 1000 / oneXMs;
}

function yieldNow(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function decideSeat(card: SeatCard, ctx: Ctx, rng: Rng): Decision {
  if (!card.bot || card.asKaiji) return kaijiDecision(ctx.hole0, ctx.hole1, ctx.board, ctx.street, ctx.toCall);
  ctx.ownElo = card.elo;
  ctx.oppAvgElo = card.oppAvg;
  return decideBot(card.bot, ctx, () => rng.next());
}

/** Sum of the 1× paint delays for one visible hand. Side tables are not animated. */
export function scheduledWatchMs(seats: SeatCard[], handIndex: number, blinds: boolean, rng: Rng): number {
  let ms = WATCH_DEAL_MS;
  const hand = new HandMachine({
    n: seats.length,
    button: handIndex % seats.length,
    blinds,
    rng,
    keepLog: false,
  });
  let guard = 0;
  while (hand.phase !== "done") {
    if (++guard > 2000) throw new Error("Hand did not finish.");
    if (hand.phase === "next-street") {
      hand.advance();
      const street = hand.phase as "act" | "next-street" | "done";
      ms += street === "done" ? WATCH_LAST_STREET_MS : WATCH_STREET_MS;
      continue;
    }
    const seat = hand.actor;
    const ctx = hand.fillCtx(seat);
    hand.act(seat, decideSeat(seats[seat], ctx, rng));
    const acted = hand.phase as "act" | "next-street" | "done";
    ms += acted === "done" ? WATCH_LAST_ACTION_MS : WATCH_ACTION_MS;
  }
  return ms + WATCH_SHOW_MS + WATCH_HOLD_MS;
}

function scheduledMsPerHand(seats: SeatCard[], blinds: boolean, rng: Rng, hands: number): number {
  let total = 0;
  for (let i = 0; i < hands; i++) total += scheduledWatchMs(seats, i, blinds, rng);
  return total / hands;
}

export async function measurePace(options: {
  seed: string;
  players: number;
  blinds: boolean;
  kaijiShare: number;
  teams?: number;
  benchMs?: number;
  cancelled?: () => boolean;
}): Promise<PaceReport> {
  const benchMs = options.benchMs ?? BENCH_MS;
  const players = options.players;
  const blinds = options.blinds;
  await yieldNow();
  if (options.cancelled?.()) return emptyReport(players, blinds);
  const field = generateField(options.seed, options.teams ?? DEFAULT_TEAMS, players);
  applyKaijiPopulation(field, options.kaijiShare);
  const watchRng = new Rng(hashString(`${options.seed}:pace-watch`) ^ 0x51a7);
  const watchSeats = drawRound(field, INITIAL_ELO, watchRng)[0];
  const scheduledMs = scheduledMsPerHand(watchSeats, blinds, watchRng, 12);
  const rng = new Rng(hashString(`${options.seed}:pace`) ^ 0x0ace);
  let kaijiElo = INITIAL_ELO;
  let tables = drawRound(field, kaijiElo, rng);
  let nets = tables.map((seats) => Array.from({ length: seats.length }, () => 0));
  let handIndex = 0;
  let hands = 0;
  await yieldNow();
  const start = performance.now();
  const deadline = start + benchMs;
  while (performance.now() < deadline) {
    if (options.cancelled?.()) return emptyReport(players, blinds);
    const slice = performance.now();
    while (performance.now() - slice < FRAME_BUDGET_MS && performance.now() < deadline) {
      for (let table = 0; table < tables.length; table++) {
        const handNets = playTableHand({ seats: tables[table], handIndex, blinds, rng, learn: true });
        const total = nets[table];
        for (let i = 0; i < handNets.length; i++) total[i] += handNets[i];
      }
      hands++;
      handIndex++;
      if (handIndex >= HANDS_PER_MATCH) {
        const nextKaiji = rateTable(tables[0], nets[0]);
        if (nextKaiji !== null) kaijiElo = nextKaiji;
        for (let i = 1; i < tables.length; i++) rateTable(tables[i], nets[i]);
        tables = drawRound(field, kaijiElo, rng);
        nets = tables.map((seats) => Array.from({ length: seats.length }, () => 0));
        handIndex = 0;
      }
    }
    await yieldNow();
  }
  const seconds = (performance.now() - start) / 1000;
  const handsPerSec = seconds > 0 ? hands / seconds : 0;
  const oneXHandsPerSec = oneXRate(handsPerSec, scheduledMs);
  return {
    maxSpeed: multiplierFromPace(handsPerSec, scheduledMs),
    handsPerSec,
    oneXHandsPerSec,
    scheduledMsPerHand: scheduledMs,
    players,
    blinds,
  };
}

function emptyReport(players: number, blinds: boolean): PaceReport {
  return {
    maxSpeed: 1,
    handsPerSec: 0,
    oneXHandsPerSec: 0,
    scheduledMsPerHand: 0,
    players,
    blinds,
  };
}
