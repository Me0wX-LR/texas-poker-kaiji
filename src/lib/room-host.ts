import { INITIAL_ELO } from "./constants";
import { HandMachine, positionName, type Decision } from "./hand";
import { kaijiDecision } from "./kaiji";
import { decideBot, type Bot } from "./policy";
import { selectPracticeBot } from "./controller";
import type { Rng } from "./rng";
import { cleanPlayerName, streetLabel, visibleHole, type TableView } from "./table-view";

export const SEAT_STALE_MS = 8000;

export interface Occupant {
  name: string;
  kind: "human" | "ai" | "open";
  playerId: string | null;
  publicKey: string | null;
  bot: Bot | null;
  detail: string;
  connected: boolean;
  lastSeen: number;
}

function copyBot(bot: Bot): Bot {
  return {
    ...bot,
    params: {
      ...bot.params,
      open: bot.params.open.slice(),
      call: bot.params.call.slice(),
      threeBet: bot.params.threeBet.slice(),
    },
    memory: { ...bot.memory },
  };
}

function openSeat(): Occupant {
  return {
    name: "Open",
    kind: "open",
    playerId: null,
    publicKey: null,
    bot: null,
    detail: "Empty chair",
    connected: true,
    lastSeen: 0,
  };
}

export class TableHost {
  readonly occupants: Occupant[];
  hand: HandMachine | null = null;
  button = 0;
  readonly nets = [0, 0, 0, 0, 0, 0];
  handNo = 0;
  private accounted = false;

  constructor(
    readonly hostId: string,
    hostName: string,
    private blinds: boolean,
    private rng: Rng,
  ) {
    this.occupants = Array.from({ length: 6 }, openSeat);
    this.occupants[0] = {
      name: cleanPlayerName(hostName),
      kind: "human",
      playerId: hostId,
      publicKey: null,
      bot: null,
      detail: "Host",
      connected: true,
      lastSeen: Date.now(),
    };
  }

  setBlinds(blinds: boolean): void {
    this.blinds = blinds;
  }

  setHostKey(publicKey: string): void {
    this.occupants[0].publicKey = publicKey;
  }

  claim(clientId: string, name: string, publicKey: string, seat: number | null): { seat: number; rejoined?: boolean } | { error: string } {
    const clean = cleanPlayerName(name);
    const sitting = this.occupants.findIndex((item) => item.playerId === clientId);
    if (sitting >= 0) {
      const rejoined = !this.occupants[sitting].connected;
      this.occupants[sitting].name = clean;
      this.occupants[sitting].publicKey = publicKey;
      this.occupants[sitting].connected = true;
      this.occupants[sitting].lastSeen = Date.now();
      const between = !this.hand || this.hand.phase === "done";
      if (between && seat !== null && seat !== sitting && this.occupants[seat]?.kind === "open") {
        this.occupants[seat] = { ...this.occupants[sitting] };
        this.occupants[sitting] = openSeat();
        return { seat, rejoined };
      }
      return { seat: sitting, rejoined };
    }
    const sameName = this.occupants.findIndex(
      (item) => item.kind === "human" && item.playerId !== this.hostId && item.name.toLowerCase() === clean.toLowerCase(),
    );
    if (sameName >= 0) {
      const reserved = this.occupants[sameName];
      if (!reserved.connected) {
        reserved.playerId = clientId;
        reserved.publicKey = publicKey;
        reserved.name = clean;
        reserved.connected = true;
        reserved.lastSeen = Date.now();
        return { seat: sameName, rejoined: true };
      }
      return { error: "That name is already at the table." };
    }
    if (this.hand && this.hand.phase !== "done") return { error: "Wait for the next hand." };
    let index = seat;
    if (index === null || index < 0 || index > 5) index = this.occupants.findIndex((item) => item.kind === "open");
    if (index < 0) return { error: "Every chair is taken." };
    const chair = this.occupants[index];
    if (!chair || chair.kind !== "open") return { error: "That chair is taken." };
    this.occupants[index] = {
      name: clean,
      kind: "human",
      playerId: clientId,
      publicKey,
      bot: null,
      detail: "Friend",
      connected: true,
      lastSeen: Date.now(),
    };
    return { seat: index };
  }

  /** A guest tab closed or went quiet. The chair stays reserved so they can sit back down. */
  markDropped(clientId: string): string | null {
    if (clientId === this.hostId) return null;
    const index = this.occupants.findIndex((item) => item.playerId === clientId);
    if (index <= 0) return null;
    const seat = this.occupants[index];
    if (seat.kind !== "human" || !seat.connected) return null;
    seat.connected = false;
    return seat.name;
  }

  noteHere(clientId: string): string | null {
    const index = this.occupants.findIndex((item) => item.playerId === clientId);
    if (index < 0) return null;
    const seat = this.occupants[index];
    const back = !seat.connected;
    seat.connected = true;
    seat.lastSeen = Date.now();
    return back ? seat.name : null;
  }

  sweep(now = Date.now()): boolean {
    let changed = false;
    for (let i = 1; i < this.occupants.length; i++) {
      const seat = this.occupants[i];
      if (seat.kind !== "human" || !seat.connected) continue;
      if (now - seat.lastSeen > SEAT_STALE_MS) {
        seat.connected = false;
        changed = true;
      }
    }
    return changed;
  }

  leave(clientId: string): void {
    if (clientId === this.hostId) return;
    if (this.hand && this.hand.phase !== "done") return;
    const index = this.occupants.findIndex((item) => item.playerId === clientId);
    if (index > 0) this.occupants[index] = openSeat();
  }

  /** Host frees an AI or a disconnected chair between hands so someone else can sit. */
  vacate(seat: number): void {
    if (this.hand && this.hand.phase !== "done") return;
    if (seat <= 0 || seat > 5) return;
    const chair = this.occupants[seat];
    if (!chair) return;
    if (chair.kind === "ai" || (chair.kind === "human" && !chair.connected)) this.occupants[seat] = openSeat();
  }

  deal(bots: Bot[]): string | null {
    if (this.hand && this.hand.phase !== "done") return "A hand is already going.";
    const taken = new Set<string>();
    for (const seat of this.occupants) if (seat.bot) taken.add(seat.bot.id);
    for (let i = 0; i < 6; i++) {
      if (this.occupants[i].kind !== "open") continue;
      const pick = selectPracticeBot(bots, "random", this.rng.next(), taken);
      if (!pick || pick === "kaiji") return "The field is still loading.";
      taken.add(pick.id);
      const usesKaiji = pick.playsKaiji;
      this.occupants[i] = {
        name: pick.name,
        kind: "ai",
        playerId: null,
        publicKey: null,
        bot: usesKaiji ? null : copyBot(pick),
        detail: usesKaiji ? "Kaiji chart" : pick.params.personality,
        connected: true,
        lastSeen: Date.now(),
      };
    }
    if (this.hand?.phase === "done") this.button = (this.button + 1) % 6;
    this.accounted = false;
    this.hand = new HandMachine({ n: 6, button: this.button, blinds: this.blinds, rng: this.rng, keepLog: true });
    this.handNo += 1;
    return null;
  }

  act(clientId: string, decision: Decision): string | null {
    const hand = this.hand;
    if (!hand || hand.phase !== "act") return "No action is open.";
    const seat = this.occupants[hand.actor];
    if (!seat || seat.playerId !== clientId) return "It is not your turn.";
    seat.connected = true;
    seat.lastSeen = Date.now();
    const act = decision?.act;
    if (act !== "fold" && act !== "check" && act !== "call" && act !== "bet" && act !== "raise" && act !== "allin") {
      return "That action was refused.";
    }
    hand.act(hand.actor, { act, to: decision.to });
    this.finishIfDone();
    return null;
  }

  aiStep(): boolean {
    const hand = this.hand;
    if (!hand || hand.phase !== "act") return false;
    const seat = this.occupants[hand.actor];
    if (!seat || seat.kind !== "ai") return false;
    const ctx = hand.fillCtx(hand.actor);
    const ratings = this.occupants.map((item) => item.bot?.elo ?? INITIAL_ELO);
    ratings[hand.actor] = seat.bot?.elo ?? INITIAL_ELO;
    let sum = 0;
    for (let i = 0; i < ratings.length; i++) if (i !== hand.actor) sum += ratings[i];
    ctx.ownElo = ratings[hand.actor];
    ctx.oppAvgElo = sum / 5;
    const decision =
      !seat.bot || seat.detail === "Kaiji chart"
        ? kaijiDecision(ctx.hole0, ctx.hole1, ctx.board, ctx.street, ctx.toCall)
        : decideBot(seat.bot, ctx, () => this.rng.next());
    hand.act(hand.actor, decision);
    this.finishIfDone();
    return true;
  }

  advance(): void {
    if (this.hand?.phase === "next-street") this.hand.advance();
    this.finishIfDone();
  }

  private finishIfDone(): void {
    const hand = this.hand;
    if (!hand || hand.phase !== "done" || this.accounted) return;
    this.accounted = true;
    for (let i = 0; i < 6; i++) this.nets[i] += hand.stack[i] - 10000;
  }

  position(seat: number): string {
    if (!this.hand) return "";
    return positionName((seat - this.button + 6) % 6, 6);
  }
}

export function hostView(host: TableHost): TableView {
  const hand = host.hand;
  const phase = !hand ? "lobby" : hand.phase === "done" ? "show" : "act";
  return {
    phase,
    yourSeat: 0,
    button: host.button,
    actor: hand && hand.phase === "act" ? hand.actor : -1,
    pot: hand?.pot ?? 0,
    board: hand ? hand.board.slice() : [],
    streetLabel: streetLabel(hand?.street ?? 0, phase),
    lastAction: hand?.lastAction ?? "",
    seats: host.occupants.map((seat, index) => {
      const away = seat.kind === "human" && !seat.connected && seat.playerId !== host.hostId;
      const detail = away ? "Disconnected" : seat.detail;
      return {
        name: seat.name,
        stack: hand ? hand.stack[index] : seat.kind === "open" ? 0 : 10000,
        folded: Boolean(hand?.folded[index]),
        allin: Boolean(hand?.allin[index]),
        empty: seat.kind === "open",
        human: seat.kind === "human",
        isYou: seat.playerId === host.hostId,
        away,
        cards: visibleHole(
          hand ? hand.hole[index] : null,
          index === 0 && Boolean(hand),
          Boolean(hand?.showdown),
          Boolean(hand?.folded[index]),
        ),
        detail: hand ? `${host.position(index)} · ${detail}` : detail,
      };
    }),
  };
}
