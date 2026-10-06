import { BIG_BLIND, INITIAL_ELO, SMALL_BLIND, STARTING_STACK } from "./constants";
import { evaluateCards } from "./eval";

export type Act = "fold" | "check" | "call" | "bet" | "raise" | "allin";

export interface Decision {
  act: Act;
  /** Street commitment to raise or bet to. Ignored for fold, check, call, and all-in. */
  to?: number;
}

export interface Legal {
  toCall: number;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  canBet: boolean;
  canRaise: boolean;
  minBetTo: number;
  minRaiseTo: number;
  maxTo: number;
}

export interface Ctx {
  seat: number;
  hole0: number;
  hole1: number;
  board: number[];
  street: number;
  toCall: number;
  pot: number;
  stack: number;
  streetPut: number;
  currentBet: number;
  minRaiseTo: number;
  minBetTo: number;
  maxTo: number;
  pos: number;
  n: number;
  ownElo: number;
  oppAvgElo: number;
  facingShove: boolean;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  canBet: boolean;
  canRaise: boolean;
}

export interface HandOptions {
  n: number;
  button: number;
  blinds: boolean;
  rng: { next(): number };
  keepLog?: boolean;
  holes?: number[][];
}

export type HandPhase = "act" | "next-street" | "done";

const POS_6 = ["BTN", "SB", "BB", "UTG", "HJ", "CO"];

export function positionName(pos: number, n: number): string {
  if (n === 2) return pos === 0 ? "BTN" : "BB";
  return POS_6[pos] ?? `P${pos}`;
}

export class HandMachine {
  readonly n: number;
  readonly button: number;
  readonly blinds: boolean;
  readonly keepLog: boolean;
  readonly stack: number[];
  readonly totalPut: number[];
  readonly streetPut: number[];
  readonly folded: boolean[];
  readonly allin: boolean[];
  readonly acted: boolean[];
  readonly hole: number[][];
  readonly board: number[] = [];
  readonly log: string[] = [];
  street = 0;
  phase: HandPhase = "act";
  currentBet = 0;
  lastFullRaise = BIG_BLIND;
  actor = 0;
  pot = 0;
  winners: number[] = [];
  showdown = false;
  lastAction = "";
  scores: number[] = [];
  private deck: number[] = [];
  private actions = 0;
  private readonly ctx: Ctx = {
    seat: 0,
    hole0: 0,
    hole1: 0,
    board: [],
    street: 0,
    toCall: 0,
    pot: 0,
    stack: 0,
    streetPut: 0,
    currentBet: 0,
    minRaiseTo: 0,
    minBetTo: 0,
    maxTo: 0,
    pos: 0,
    n: 0,
    ownElo: INITIAL_ELO,
    oppAvgElo: INITIAL_ELO,
    facingShove: false,
    canFold: false,
    canCheck: false,
    canCall: false,
    canBet: false,
    canRaise: false,
  };

  constructor(options: HandOptions) {
    this.n = options.n;
    this.button = options.button;
    this.blinds = options.blinds;
    this.keepLog = options.keepLog ?? false;
    this.stack = Array.from({ length: this.n }, () => STARTING_STACK);
    this.totalPut = Array.from({ length: this.n }, () => 0);
    this.streetPut = Array.from({ length: this.n }, () => 0);
    this.folded = Array.from({ length: this.n }, () => false);
    this.allin = Array.from({ length: this.n }, () => false);
    this.acted = Array.from({ length: this.n }, () => false);
    this.hole = Array.from({ length: this.n }, () => [0, 0]);
    this.dealHoles(options.rng, options.holes);
    if (options.blinds) {
      const small = this.n === 2 ? this.button : this.seatOffset(1);
      const big = this.n === 2 ? this.seatOffset(1) : this.seatOffset(2);
      this.commit(small, SMALL_BLIND);
      this.commit(big, BIG_BLIND);
      this.currentBet = this.streetPut[big];
    }
    this.lastFullRaise = BIG_BLIND;
    this.actor = this.firstPreflop();
    this.phase = "act";
  }

  seatOffset(offset: number): number {
    return (this.button + offset) % this.n;
  }

  liveCount(): number {
    let n = 0;
    for (let i = 0; i < this.n; i++) if (!this.folded[i]) n++;
    return n;
  }

  chips(): number {
    let sum = this.pot;
    for (let i = 0; i < this.n; i++) sum += this.stack[i];
    return sum;
  }

  legal(seat: number): Legal {
    const toCall = this.currentBet - this.streetPut[seat];
    const maxTo = this.streetPut[seat] + this.stack[seat];
    const canAct = !this.folded[seat] && !this.allin[seat] && this.stack[seat] > 0;
    return {
      toCall,
      canFold: canAct && toCall > 0,
      canCheck: canAct && toCall <= 0,
      canCall: canAct && toCall > 0,
      canBet: canAct && toCall <= 0,
      canRaise: canAct && toCall > 0 && maxTo > this.currentBet,
      minBetTo: Math.min(BIG_BLIND, maxTo),
      minRaiseTo: Math.min(maxTo, this.currentBet + this.lastFullRaise),
      maxTo,
    };
  }

  fillCtx(seat: number, ownElo = INITIAL_ELO, oppAvgElo = INITIAL_ELO): Ctx {
    const legal = this.legal(seat);
    let facingShove = false;
    if (legal.toCall > 0) {
      if (legal.toCall >= this.stack[seat]) facingShove = true;
      else {
        for (let j = 0; j < this.n; j++) {
          if (j !== seat && !this.folded[j] && this.allin[j] && this.streetPut[j] >= this.currentBet) {
            facingShove = true;
            break;
          }
        }
      }
    }
    const ctx = this.ctx;
    ctx.seat = seat;
    ctx.hole0 = this.hole[seat][0];
    ctx.hole1 = this.hole[seat][1];
    ctx.board = this.board;
    ctx.street = this.street;
    ctx.toCall = legal.toCall;
    ctx.pot = this.pot;
    ctx.stack = this.stack[seat];
    ctx.streetPut = this.streetPut[seat];
    ctx.currentBet = this.currentBet;
    ctx.minRaiseTo = legal.minRaiseTo;
    ctx.minBetTo = legal.minBetTo;
    ctx.maxTo = legal.maxTo;
    ctx.pos = (seat - this.button + this.n) % this.n;
    ctx.n = this.n;
    ctx.ownElo = ownElo;
    ctx.oppAvgElo = oppAvgElo;
    ctx.facingShove = facingShove;
    ctx.canFold = legal.canFold;
    ctx.canCheck = legal.canCheck;
    ctx.canCall = legal.canCall;
    ctx.canBet = legal.canBet;
    ctx.canRaise = legal.canRaise;
    return ctx;
  }

  act(seat: number, decision: Decision): void {
    if (this.phase !== "act") throw new Error("No action is open.");
    if (seat !== this.actor) throw new Error("That seat is not facing a decision.");
    const legal = this.legal(seat);
    let act = decision.act;
    let to = decision.to ?? 0;
    if (act === "allin") {
      to = legal.maxTo;
      if (legal.toCall <= 0) act = "bet";
      else if (to > this.currentBet) act = "raise";
      else act = "call";
    }
    if (legal.toCall <= 0) {
      if (act === "fold" || act === "call" || act === "raise") act = "check";
      if (act === "bet" && !legal.canBet) act = "check";
    } else if (act === "check" || act === "bet") {
      act = legal.canCall ? "call" : "fold";
    }

    if (act === "fold" && legal.canFold) {
      this.folded[seat] = true;
      this.acted[seat] = true;
      this.note(seat, "folds");
    } else if (act === "check" && legal.canCheck) {
      this.acted[seat] = true;
      this.note(seat, "checks");
    } else if (act === "call" && legal.canCall) {
      this.commit(seat, Math.min(legal.toCall, this.stack[seat]));
      this.acted[seat] = true;
      this.note(seat, this.allin[seat] ? "calls all-in" : `calls ${legal.toCall}`);
    } else if (act === "bet" && legal.canBet) {
      let target = to;
      if (!(target > 0)) target = legal.minBetTo;
      if (target < legal.minBetTo) target = legal.minBetTo;
      if (target > legal.maxTo) target = legal.maxTo;
      this.commit(seat, target - this.streetPut[seat]);
      const betSize = this.streetPut[seat];
      this.currentBet = betSize;
      this.lastFullRaise = Math.max(1, betSize);
      this.reopen(seat);
      this.acted[seat] = true;
      this.note(seat, this.allin[seat] ? "shoves" : `bets ${betSize}`);
    } else if (act === "raise" && legal.canRaise) {
      let target = to;
      if (target > legal.maxTo) target = legal.maxTo;
      if (target < legal.minRaiseTo) target = legal.maxTo < this.currentBet + this.lastFullRaise ? legal.maxTo : legal.minRaiseTo;
      const previous = this.currentBet;
      this.commit(seat, target - this.streetPut[seat]);
      const increase = this.streetPut[seat] - previous;
      if (increase > 0) {
        this.currentBet = this.streetPut[seat];
        if (increase >= this.lastFullRaise) this.lastFullRaise = increase;
        this.reopen(seat);
      }
      this.acted[seat] = true;
      this.note(seat, this.allin[seat] ? "shoves" : `raises to ${this.streetPut[seat]}`);
    } else if (legal.canCheck) {
      this.acted[seat] = true;
      this.note(seat, "checks");
    } else {
      this.folded[seat] = true;
      this.acted[seat] = true;
      this.note(seat, "folds");
    }

    this.actions++;
    if (this.actions > 1500) throw new Error("Betting round did not close.");
    this.afterAction(seat);
  }

  advance(): void {
    if (this.phase !== "next-street") return;
    if (this.street < 3) {
      this.street++;
      const need = this.street === 1 ? 3 : 1;
      for (let i = 0; i < need; i++) {
        const card = this.deck.pop();
        if (card === undefined) throw new Error("The deck ran out.");
        this.board.push(card);
      }
      this.currentBet = 0;
      this.lastFullRaise = BIG_BLIND;
      for (let i = 0; i < this.n; i++) {
        this.streetPut[i] = 0;
        this.acted[i] = this.folded[i] || this.allin[i];
      }
      if (this.someoneCanAct()) {
        this.phase = "act";
        this.actor = this.firstPostflop();
        return;
      }
      if (this.street < 3) {
        this.phase = "next-street";
        return;
      }
    }
    this.resolveShowdown();
  }

  private dealHoles(rng: { next(): number }, preset?: number[][]): void {
    const used = new Uint8Array(52);
    if (preset) {
      for (let i = 0; i < this.n; i++) {
        this.hole[i][0] = preset[i][0];
        this.hole[i][1] = preset[i][1];
        used[preset[i][0]] = 1;
        used[preset[i][1]] = 1;
      }
    }
    const deck: number[] = [];
    for (let i = 0; i < 52; i++) if (!used[i]) deck.push(i);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }
    this.deck = deck;
    if (!preset) {
      for (let i = 0; i < this.n; i++) {
        this.hole[i][0] = deck.pop() as number;
        this.hole[i][1] = deck.pop() as number;
      }
    }
  }

  private commit(seat: number, amount: number): void {
    const pay = amount > this.stack[seat] ? this.stack[seat] : amount;
    if (pay <= 0) return;
    this.stack[seat] -= pay;
    this.streetPut[seat] += pay;
    this.totalPut[seat] += pay;
    this.pot += pay;
    if (this.stack[seat] === 0) this.allin[seat] = true;
  }

  private note(seat: number, text: string): void {
    const pos = positionName((seat - this.button + this.n) % this.n, this.n);
    this.lastAction = `${pos} ${text}`;
    if (!this.keepLog) return;
    this.log.push(this.lastAction);
    if (this.log.length > 24) this.log.shift();
  }

  private reopen(seat: number): void {
    for (let j = 0; j < this.n; j++) {
      if (j === seat || this.folded[j] || this.allin[j]) continue;
      this.acted[j] = false;
    }
  }

  private afterAction(seat: number): void {
    if (this.liveCount() <= 1) {
      this.resolveFold();
      return;
    }
    if (this.streetDone()) {
      if (this.street >= 3) this.resolveShowdown();
      else {
        this.phase = "next-street";
        this.actor = -1;
      }
      return;
    }
    const next = this.nextActor(seat);
    if (next < 0) {
      this.phase = this.street >= 3 ? "done" : "next-street";
      if (this.street >= 3) this.resolveShowdown();
      else this.actor = -1;
      return;
    }
    this.actor = next;
  }

  private streetDone(): boolean {
    for (let i = 0; i < this.n; i++) {
      if (this.folded[i] || this.allin[i]) continue;
      if (!this.acted[i] || this.streetPut[i] !== this.currentBet) return false;
    }
    return true;
  }

  private someoneCanAct(): boolean {
    for (let i = 0; i < this.n; i++) {
      if (!this.folded[i] && !this.allin[i] && this.stack[i] > 0) return true;
    }
    return false;
  }

  private needsToAct(seat: number): boolean {
    if (this.folded[seat] || this.allin[seat]) return false;
    return !this.acted[seat] || this.streetPut[seat] !== this.currentBet;
  }

  private nextActor(from: number): number {
    for (let k = 1; k <= this.n; k++) {
      const seat = (from + k) % this.n;
      if (this.needsToAct(seat)) return seat;
    }
    return -1;
  }

  private firstPreflop(): number {
    const start = this.n === 2 ? this.button : this.seatOffset(3);
    return this.nextActor((start - 1 + this.n) % this.n);
  }

  private firstPostflop(): number {
    return this.nextActor(this.button);
  }

  private returnUncalled(): void {
    let max = 0;
    let second = 0;
    let maxSeat = -1;
    for (let i = 0; i < this.n; i++) {
      const put = this.totalPut[i];
      if (put > max) {
        second = max;
        max = put;
        maxSeat = i;
      } else if (put > second) second = put;
    }
    if (maxSeat >= 0 && max > second) {
      const refund = max - second;
      this.totalPut[maxSeat] -= refund;
      this.stack[maxSeat] += refund;
      this.pot -= refund;
    }
  }

  private resolveFold(): void {
    this.returnUncalled();
    let winner = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.folded[i]) winner = i;
    }
    this.stack[winner] += this.pot;
    this.pot = 0;
    this.winners = [winner];
    this.showdown = false;
    this.phase = "done";
    this.actor = -1;
    this.scores = Array.from({ length: this.n }, () => -1);
  }

  private resolveShowdown(): void {
    this.returnUncalled();
    if (this.pot === 0) {
      this.winners = [];
      this.showdown = true;
      this.phase = "done";
      this.actor = -1;
      this.scores = Array.from({ length: this.n }, () => -1);
      this.lastAction = "Checked down. No chips move.";
      if (this.keepLog) this.log.push(this.lastAction);
      return;
    }
    const scores = new Array<number>(this.n).fill(-1);
    for (let i = 0; i < this.n; i++) {
      if (this.folded[i]) continue;
      const cards = this.hole[i].concat(this.board);
      scores[i] = evaluateCards(cards);
    }
    this.scores = scores;
    const levels = Array.from(new Set(this.totalPut.filter((value) => value > 0))).sort((a, b) => a - b);
    const won = new Array<number>(this.n).fill(0);
    let previous = 0;
    for (const level of levels) {
      const slice = level - previous;
      let potSlice = 0;
      const contenders: number[] = [];
      for (let i = 0; i < this.n; i++) {
        if (this.totalPut[i] >= level) {
          potSlice += slice;
          if (!this.folded[i]) contenders.push(i);
        }
      }
      previous = level;
      if (potSlice <= 0 || contenders.length === 0) continue;
      let best = -1;
      for (const seat of contenders) if (scores[seat] > best) best = scores[seat];
      const tied = contenders.filter((seat) => scores[seat] === best);
      const ordered = this.leftOfButton(tied);
      const share = Math.floor(potSlice / ordered.length);
      let remainder = potSlice - share * ordered.length;
      for (const seat of ordered) {
        const extra = remainder > 0 ? 1 : 0;
        if (remainder > 0) remainder--;
        this.stack[seat] += share + extra;
        won[seat] += share + extra;
      }
      this.pot -= potSlice;
    }
    if (this.pot !== 0) {
      const fallback = this.leftOfButton(
        Array.from({ length: this.n }, (_, i) => i).filter((i) => !this.folded[i]),
      )[0];
      if (fallback !== undefined) {
        this.stack[fallback] += this.pot;
        won[fallback] += this.pot;
        this.pot = 0;
      }
    }
    this.winners = won.flatMap((amount, seat) => (amount > 0 ? [seat] : []));
    this.showdown = true;
    this.phase = "done";
    this.actor = -1;
    const names = this.winners.map((seat) => positionName((seat - this.button + this.n) % this.n, this.n));
    this.lastAction = names.length > 1 ? `${names.join(" & ")} split the pot` : `${names[0] ?? "Seat"} wins at showdown`;
    if (this.keepLog) this.log.push(this.lastAction);
  }

  private leftOfButton(seats: number[]): number[] {
    const wanted = new Set(seats);
    const ordered: number[] = [];
    for (let k = 1; k <= this.n; k++) {
      const seat = (this.button + k) % this.n;
      if (wanted.has(seat)) ordered.push(seat);
    }
    return ordered;
  }
}

export interface HandResult {
  stacks: number[];
  nets: number[];
  showdown: boolean;
  winners: number[];
  board: number[];
  holes: number[][];
  button: number;
  log: string[];
  lastAction: string;
  folded: boolean[];
  facedShove: boolean[];
  foldedToShove: boolean[];
  agg: number;
  passive: number;
}

export function playHand(
  options: HandOptions & {
    decide: (seat: number, ctx: Ctx, hand: HandMachine) => Decision;
  },
): HandResult {
  const hand = new HandMachine(options);
  const facedShove = Array.from({ length: options.n }, () => false);
  const foldedToShove = Array.from({ length: options.n }, () => false);
  let agg = 0;
  let passive = 0;
  let guard = 0;
  while (hand.phase !== "done") {
    if (++guard > 2000) throw new Error("Hand did not finish.");
    if (hand.phase === "next-street") {
      hand.advance();
      continue;
    }
    const seat = hand.actor;
    const ctx = hand.fillCtx(seat);
    const decision = options.decide(seat, ctx, hand);
    if (ctx.facingShove) facedShove[seat] = true;
    if (decision.act === "fold" && ctx.facingShove) foldedToShove[seat] = true;
    if (decision.act === "bet" || decision.act === "raise" || decision.act === "allin") agg++;
    else passive++;
    hand.act(seat, decision);
  }
  return {
    stacks: hand.stack.slice(),
    nets: hand.stack.map((stack) => stack - STARTING_STACK),
    showdown: hand.showdown,
    winners: hand.winners.slice(),
    board: hand.board.slice(),
    holes: hand.hole.map((cards) => cards.slice()),
    button: hand.button,
    log: hand.log.slice(),
    lastAction: hand.lastAction,
    folded: hand.folded.slice(),
    facedShove,
    foldedToShove,
    agg,
    passive,
  };
}
