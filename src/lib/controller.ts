import {
  DEFAULT_BOTS,
  DEFAULT_HAND_DEADLINE,
  DEFAULT_MATCH_DEADLINE,
  DEFAULT_SEED,
  DEFAULT_TEAMS,
  HANDS_PER_MATCH,
  INITIAL_ELO,
  STARTING_STACK,
  TIER_LABEL,
  TIERS,
  type Tier,
  formatElo,
  formatMatchTime,
} from "./constants";
import { eloUpdates, placementScores } from "./elo";
import { Field, applyKaijiPopulation, generateField, teamMeans, teamName, teamPools, tierMeans, tierPools, validateField } from "./field";
import { HandMachine, HandResult, playHand } from "./hand";
import { kaijiDecision } from "./kaiji";
import { SeatCard, drawSeats } from "./match";
import { decideBot, learnFromHand, type Bot } from "./policy";
import { Rng, hashString } from "./rng";
import { HistoryPoint, SaveData, clearSave, loadSave, writeSave } from "./storage";

export interface SeatLabel {
  name: string;
  detail: string;
  team: string;
  style: string;
  elo: number;
  isKaiji: boolean;
  folded: boolean;
  allin: boolean;
  stack: number;
  put: number;
  isButton: boolean;
  isActor: boolean;
  holes: number[];
}

export interface TableSnap {
  board: number[];
  pot: number;
  street: number;
  lastAction: string;
  log: string[];
  showdown: boolean;
  done: boolean;
  winners: number[];
  seats: SeatLabel[];
  matchNets: number[];
  matchHands: number;
  matchIndex: number;
}

export type PracticePool = "random" | "kaiji" | "kaiji-chart" | Tier | `style:${string}`;

export interface PracticeSeat {
  name: string;
  style: string;
  personality: string;
  usesKaiji: boolean;
  bot: Bot | null;
}

/** Draw one field player for a practice seat. `roll` is in [0, 1). Kaiji himself is not in the field. */
export function selectPracticeBot(bots: Bot[], pool: PracticePool, roll: number): Bot | "kaiji" | null {
  if (pool === "kaiji") return "kaiji";
  let choices = bots;
  if (pool === "kaiji-chart") choices = bots.filter((bot) => bot.playsKaiji);
  else if (pool.startsWith("style:")) {
    const personality = pool.slice("style:".length);
    choices = bots.filter((bot) => !bot.playsKaiji && bot.params.personality === personality);
  } else if (pool !== "random") {
    choices = bots.filter((bot) => bot.tier === pool && !bot.playsKaiji);
  }
  if (choices.length === 0) return null;
  const index = Math.min(choices.length - 1, Math.max(0, Math.floor(roll * choices.length)));
  return choices[index];
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

function seatFromPick(pick: Bot | "kaiji"): PracticeSeat {
  if (pick === "kaiji") {
    return { name: "Kaiji", style: "Kaiji", personality: "Static chart", usesKaiji: true, bot: null };
  }
  const usesKaiji = pick.playsKaiji;
  return {
    name: pick.name,
    style: usesKaiji ? "Kaiji chart" : TIER_LABEL[pick.tier],
    personality: pick.params.personality,
    usesKaiji,
    bot: usesKaiji ? null : copyBot(pick),
  };
}

export interface BotHit {
  id: string;
  name: string;
  style: string;
  tier: Tier;
  elo: number;
  matches: number;
  note: string;
}

export interface LadderRow {
  id: string;
  rank: number;
  name: string;
  style: string;
  elo: number;
  matches: number;
  isHero: boolean;
}

export interface VerdictRow {
  tier: Tier;
  label: string;
  elo: number;
  result: "ahead" | "behind" | "level";
  delta: number;
}

export interface SimSnap {
  phase: "loading" | "ready" | "error";
  error: string | null;
  notice: string | null;
  running: boolean;
  locked: boolean;
  lockReason: "match" | "hand" | null;
  speed: number;
  blinds: boolean;
  blindsMixed: boolean;
  seed: string;
  teamCount: number;
  botCount: number;
  /** Whole percent of the bot field that plays Kaiji's chart. Set when the run starts. */
  kaijiShare: number;
  kaijiPopulation: number;
  matchDeadline: number;
  handDeadline: number;
  matchesCompleted: number;
  handsPlayed: number;
  kaijiMatches: number;
  kaijiWins: number;
  /** Rated matches counted in the win rate. Older saves start this after the matches already played. */
  winrateTracked: number;
  kaijiElo: number;
  kaijiChips: number;
  tierChips: Record<Tier, number>;
  tiers: Record<Tier, number>;
  benchTiers: Record<Tier, number>;
  /** 1,500 plus the sum of that tier's Elo changes. A group total, not a rating. */
  tierPiles: Record<Tier, number>;
  teamElos: number[];
  teamPiles: number[];
  teamNames: string[];
  ladder: LadderRow[];
  kaijiRank: number;
  fieldSize: number;
  history: HistoryPoint[];
  table: TableSnap | null;
  clock: string;
  verdict: { rows: VerdictRow[]; summary: string } | null;
  lockCopy: string | null;
  restored: boolean;
  tierCounts: Record<Tier, number>;
}

const EMPTY_TIERS: Record<Tier, number> = { gto: 0, dynamic: 0, frozen: 0, agentic: 0 };

function freshTierChips(): Record<Tier, number> {
  return { gto: 0, dynamic: 0, frozen: 0, agentic: 0 };
}

export class SimController {
  private field: Field | null = null;
  private rng = new Rng(1);
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private speed = 1;
  private blinds = true;
  private blindsMixed = false;
  private blindMark: boolean | null = null;
  private seed = DEFAULT_SEED;
  private matchDeadline = DEFAULT_MATCH_DEADLINE;
  private handDeadline = DEFAULT_HAND_DEADLINE;
  private matchesCompleted = 0;
  private handsPlayed = 0;
  private kaijiShare = 0;
  private kaijiMatches = 0;
  private kaijiWins = 0;
  private winrateFrom = 0;
  private kaijiElo = INITIAL_ELO;
  private kaijiChips = 0;
  private tierChips = freshTierChips();
  private teamChips: number[] = [];
  private history: HistoryPoint[] = [];
  private locked = false;
  private lockReason: "match" | "hand" | null = null;
  private error: string | null = null;
  private notice: string | null = null;
  private booted = false;
  private restored = false;
  private live: { index: number; handsDone: number; nets: number[]; seats: SeatCard[] } | null = null;
  private hand: HandMachine | null = null;
  private preview: HandResult | null = null;
  private previewSeats: SeatCard[] | null = null;
  private displayNets: number[] = [0, 0, 0, 0, 0, 0];
  private resultHold = false;
  private holdMs = 460;
  private faced: boolean[] = [];
  private foldedTo: boolean[] = [];
  private agg = 0;
  private passive = 0;
  private lastEmit = 0;
  private tierCounts: Record<Tier, number> = { ...EMPTY_TIERS };

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  boot(): void {
    try {
      const saved = loadSave();
      if (saved) this.restore(saved);
      else this.applyNew(DEFAULT_SEED, DEFAULT_TEAMS, DEFAULT_BOTS, false);
      this.booted = true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : "The saved ladder could not be read.";
      this.booted = true;
    }
    this.emit();
  }

  dispose(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  start(): void {
    if (this.locked || this.error || !this.field) return;
    this.running = true;
    this.notice = null;
    this.emit();
    this.arm(this.speed <= 1 ? 80 : 0);
  }

  pause(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.emit();
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(1, Math.min(1000, Math.round(speed)));
    if (this.running) this.arm(this.speed <= 1 ? 80 : 0);
    this.emit();
  }

  setBlinds(blinds: boolean): void {
    this.blinds = blinds;
    this.emit();
  }

  setMatchDeadline(matchDeadline: number): string | null {
    if (!Number.isInteger(matchDeadline) || matchDeadline < 1) return "Match deadline needs a whole number of at least 1.";
    if (this.locked) return "This run is locked. Start a new run to open another window.";
    this.matchDeadline = matchDeadline;
    this.handDeadline = matchDeadline * HANDS_PER_MATCH;
    if (this.matchesCompleted >= matchDeadline) this.lock("match");
    else if (this.handsPlayed >= this.handDeadline) this.lock("hand");
    this.emit();
    return null;
  }

  newRun(seed: string, botCount: number, kaijiShare: number): string | null {
    const clean = seed.trim();
    if (!clean) return "The run needs a seed.";
    if (!Number.isInteger(kaijiShare) || kaijiShare < 0 || kaijiShare > 100) {
      return "Kaiji population needs a whole percent from 0 to 100.";
    }
    const problem = validateField(DEFAULT_TEAMS, botCount);
    if (problem) return problem;
    this.pause();
    this.error = null;
    this.kaijiShare = kaijiShare;
    this.applyNew(clean, DEFAULT_TEAMS, botCount, true);
    this.emit();
    return null;
  }

  practiceOpponent(pool: PracticePool): PracticeSeat | null {
    if (!this.field && pool !== "kaiji") return null;
    const pick = selectPracticeBot(this.field?.bots ?? [], pool, Math.random());
    return pick ? seatFromPick(pick) : null;
  }

  findBots(query: string): BotHit[] {
    if (!this.field) return [];
    const q = query.trim().toLowerCase();
    const pool = q
        ? this.field.bots.filter((bot) => {
          const style = (bot.playsKaiji ? "kaiji chart" : TIER_LABEL[bot.tier]).toLowerCase();
          return bot.name.toLowerCase().includes(q) || bot.id.includes(q) || style.includes(q) || bot.params.personality.toLowerCase().includes(q);
        })
      : this.field.bots.slice(0, 8);
    return pool.slice(0, 36).map((bot) => ({
      id: bot.id,
      name: bot.name,
      style: bot.playsKaiji ? "Kaiji chart" : TIER_LABEL[bot.tier],
      tier: bot.tier,
      elo: bot.elo,
      matches: bot.matches,
      note: this.botNote(bot),
    }));
  }

  snapshot(): SimSnap {
    const tiers = this.field ? tierMeans(this.field.bots) : { gto: INITIAL_ELO, dynamic: INITIAL_ELO, frozen: INITIAL_ELO, agentic: INITIAL_ELO };
    const tierPiles = this.field ? tierPools(this.field.bots) : tiers;
    const teamElos = this.field ? teamMeans(this.field, this.kaijiElo) : [this.kaijiElo];
    const teamPiles = this.field ? teamPools(this.field, this.kaijiElo) : [this.kaijiElo];
    const teamNames = this.field ? Array.from({ length: this.field.teamCount }, (_, i) => teamName(i)) : ["Kaiji"];
    const ladder = this.playerLadder();
    return {
      phase: !this.booted ? "loading" : this.error ? "error" : "ready",
      error: this.error,
      notice: this.notice,
      running: this.running,
      locked: this.locked,
      lockReason: this.lockReason,
      speed: this.speed,
      blinds: this.blinds,
      blindsMixed: this.blindsMixed,
      seed: this.seed,
      teamCount: this.field?.teamCount ?? DEFAULT_TEAMS,
      botCount: this.field?.botCount ?? DEFAULT_BOTS,
      kaijiShare: this.kaijiShare,
      kaijiPopulation: this.field ? this.field.bots.filter((bot) => bot.playsKaiji).length : 0,
      matchDeadline: this.matchDeadline,
      handDeadline: this.handDeadline,
      matchesCompleted: this.matchesCompleted,
      handsPlayed: this.handsPlayed,
      kaijiMatches: this.kaijiMatches,
      kaijiWins: this.kaijiWins,
      winrateTracked: Math.max(0, this.kaijiMatches - this.winrateFrom),
      kaijiElo: this.kaijiElo,
      kaijiChips: this.kaijiChips,
      tierChips: { ...this.tierChips },
      tiers,
      benchTiers: tiers,
      tierPiles,
      teamElos,
      teamPiles,
      teamNames,
      ladder: ladder.rows,
      kaijiRank: ladder.kaijiRank,
      fieldSize: ladder.fieldSize,
      history: this.history,
      table: this.tableSnap(),
      clock: this.clockText(),
      verdict: this.matchesCompleted > 0 ? this.verdict(tiers) : null,
      lockCopy: this.locked ? this.lockText() : null,
      restored: this.restored,
      tierCounts: this.tierCounts,
    };
  }

  private playerLadder(): { rows: LadderRow[]; kaijiRank: number; fieldSize: number } {
    const entries: Array<Omit<LadderRow, "rank">> = [
      { id: "kaiji", name: "Kaiji", style: "Kaiji", elo: this.kaijiElo, matches: this.kaijiMatches, isHero: true },
    ];
    for (const bot of this.field?.bots ?? []) {
      entries.push({
        id: bot.id,
        name: bot.name,
        style: bot.playsKaiji ? "Kaiji chart" : TIER_LABEL[bot.tier],
        elo: bot.elo,
        matches: bot.matches,
        isHero: false,
      });
    }
    entries.sort((a, b) => b.elo - a.elo || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const ranked = entries.map((row, index) => ({ ...row, rank: index + 1 }));
    const hero = ranked.find((row) => row.isHero);
    return {
      rows: ranked,
      kaijiRank: hero?.rank ?? ranked.length,
      fieldSize: ranked.length,
    };
  }

  private botNote(bot: Field["bots"][number]): string {
    if (bot.tier === "frozen") return `${bot.params.personality} · fixed at creation`;
    if (bot.tier === "dynamic") {
      return `${bot.params.personality} · tightness slope ${bot.params.eloTight.toFixed(2)}, aggression slope ${bot.params.eloAgg.toFixed(2)}`;
    }
    if (bot.tier === "agentic") {
      return `${bot.params.personality} · open ${bot.memory.openShift.toFixed(3)}, bluff ${bot.memory.bluffShift.toFixed(3)}, after ${bot.memory.hands} hands`;
    }
    return `${bot.params.personality} · fixed push-fold chart and equity heuristic`;
  }

  private verdict(tiers: Record<Tier, number>): { rows: VerdictRow[]; summary: string } {
    const kaiji = Math.round(this.kaijiElo);
    const rows: VerdictRow[] = TIERS.map((tier) => {
      const elo = tiers[tier];
      const rounded = Math.round(elo);
      const result = kaiji > rounded ? "ahead" : kaiji < rounded ? "behind" : "level";
      return { tier, label: TIER_LABEL[tier], elo, result, delta: kaiji - rounded };
    });
    const ahead = rows.filter((row) => row.result === "ahead").length;
    let summary: string;
    if (rows.every((row) => row.result === "ahead")) summary = "The static chart is ahead of all four tiers.";
    else if (rows.every((row) => row.result === "behind")) summary = "The static chart is behind all four tiers.";
    else if (rows.every((row) => row.result === "level")) summary = "The static chart is level with every tier.";
    else summary = `The static chart is ahead of ${ahead} of 4 tiers.`;
    return { rows, summary };
  }

  private lockText(): string {
    const elo = formatElo(this.kaijiElo);
    if (this.matchesCompleted === 0) {
      return `Deadline reached before a full match was scored. Kaiji's Elo stays locked at ${elo}.`;
    }
    const why = this.lockReason === "hand" ? "Hand total" : "Match deadline";
    return `${why} reached. Kaiji's Elo is locked at ${elo}.`;
  }

  private clockText(): string {
    if (this.locked && this.lockReason === "match" && this.matchesCompleted > 0) {
      return `Window closed · last match started ${formatMatchTime(this.matchesCompleted - 1)}`;
    }
    const index = this.live?.index ?? this.matchesCompleted;
    return `Next forced match · ${formatMatchTime(index)}`;
  }

  private tableSnap(): TableSnap | null {
    const seats = this.live?.seats ?? this.previewSeats;
    const source = this.hand ?? null;
    const preview = this.preview;
    if (!seats || (!source && !preview)) return null;
    const board = source ? source.board.slice() : preview!.board;
    const holes = source ? source.hole : preview!.holes;
    const folded = source ? source.folded : preview!.folded;
    const allin = source ? source.allin : preview!.stacks.map((stack, i) => stack === 0 && !preview!.folded[i]);
    const stack = source ? source.stack : preview!.stacks;
    const streetPut = source ? source.streetPut : seats.map(() => 0);
    const pot = source ? source.pot : 0;
    const actor = source && source.phase === "act" ? source.actor : -1;
    const button = source ? source.button : preview!.button;
    const showdown = source ? source.showdown : preview!.showdown;
    const done = source ? source.phase === "done" : true;
    const winners = source ? source.winners : preview!.winners;
    const lastAction = source ? source.lastAction : preview!.lastAction;
    const log = source ? source.log.slice() : preview!.log;
    const street = source ? source.street : board.length === 0 ? 0 : board.length === 3 ? 1 : board.length === 4 ? 2 : 3;
    return {
      board,
      pot,
      street,
      lastAction,
      log,
      showdown,
      done,
      winners,
      matchNets: (this.live ? this.live.nets : this.displayNets).slice(),
      matchHands: this.live?.handsDone ?? HANDS_PER_MATCH,
      matchIndex: this.live?.index ?? Math.max(0, this.matchesCompleted - 1),
      seats: seats.map((card, i) => ({
        name: card.bot ? card.bot.name : "Kaiji",
        detail: card.bot ? this.botNote(card.bot) : "Static chart. Never updates.",
        team: teamName(card.team),
        style: !card.bot ? "Kaiji" : card.asKaiji ? "Kaiji chart" : TIER_LABEL[card.bot.tier],
        elo: card.bot ? card.bot.elo : this.kaijiElo,
        isKaiji: card.bot === null,
        folded: folded[i] ?? false,
        allin: allin[i] ?? false,
        stack: stack[i] ?? STARTING_STACK,
        put: streetPut[i] ?? 0,
        isButton: i === button,
        isActor: i === actor,
        holes: holes[i] ? holes[i].slice() : [],
      })),
    };
  }

  private applyNew(seed: string, teamCount: number, botCount: number, cleared: boolean): void {
    this.field = generateField(seed, teamCount, botCount);
    applyKaijiPopulation(this.field, this.kaijiShare);
    this.seed = seed;
    this.rng = new Rng(hashString(`${seed}:sim`) ^ 0x51d0);
    this.blindsMixed = false;
    this.blindMark = null;
    this.matchesCompleted = 0;
    this.handsPlayed = 0;
    this.kaijiMatches = 0;
    this.kaijiWins = 0;
    this.winrateFrom = 0;
    this.kaijiElo = INITIAL_ELO;
    this.kaijiChips = 0;
    this.tierChips = freshTierChips();
    this.teamChips = Array.from({ length: teamCount }, () => 0);
    this.history = [];
    this.locked = false;
    this.lockReason = null;
    this.live = null;
    this.hand = null;
    this.preview = null;
    this.previewSeats = null;
    this.resultHold = false;
    this.notice = cleared ? "New run. Everyone is back at 1,500." : null;
    this.restored = false;
    this.countTiers();
    if (cleared) this.persist();
  }

  private restore(saved: SaveData): void {
    const problem = validateField(saved.teamCount, saved.botCount);
    if (problem) throw new Error(problem);
    this.field = generateField(saved.seed, saved.teamCount, saved.botCount);
    this.kaijiShare = saved.kaijiShare ?? 0;
    applyKaijiPopulation(this.field, this.kaijiShare);
    this.seed = saved.seed;
    for (const bot of this.field.bots) {
      if (typeof saved.elos[bot.id] === "number") bot.elo = saved.elos[bot.id];
      bot.matches = saved.botMatches[bot.id] ?? 0;
      const memory = saved.agentic[bot.id];
      if (memory) bot.memory = { ...bot.memory, ...memory };
    }
    this.rng = new Rng(1);
    this.rng.setState(saved.rngState);
    this.blinds = saved.blinds;
    this.blindsMixed = saved.blindsMixed;
    this.matchDeadline = saved.matchDeadline;
    this.handDeadline = saved.matchDeadline * HANDS_PER_MATCH;
    this.matchesCompleted = saved.matchesCompleted;
    this.handsPlayed = saved.handsPlayed;
    this.kaijiMatches = saved.kaijiMatches;
    this.kaijiWins = saved.kaijiWins ?? 0;
    this.winrateFrom = saved.winrateFrom ?? (saved.kaijiWins === undefined ? saved.kaijiMatches : 0);
    this.kaijiElo = saved.kaijiElo;
    this.kaijiChips = saved.kaijiChips;
    this.tierChips = { ...saved.tierChips };
    this.teamChips = saved.teamChips.slice();
    this.history = saved.meanHistory ? saved.history : this.matchesCompleted > 0 ? [this.historyPoint()] : [];
    this.locked = saved.locked;
    this.lockReason = saved.lockReason;
    this.restored = saved.matchesCompleted > 0 || saved.locked;
    this.notice = this.restored ? "Restored the ladder saved in this browser." : null;
    this.countTiers();
  }

  private countTiers(): void {
    const counts = { ...EMPTY_TIERS };
    for (const bot of this.field?.bots ?? []) counts[bot.tier]++;
    this.tierCounts = counts;
  }

  private arm(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(), delay);
  }

  private tick(): void {
    this.timer = null;
    if (!this.running || this.locked) {
      this.running = false;
      this.emit();
      return;
    }
    let delay = this.speed <= 1 ? 460 : this.speed < 80 ? 32 : 0;
    try {
      if (this.speed <= 1) {
        delay = this.stepWatch();
      } else {
        const budget = this.speed >= 200 ? 16 : 10;
        const target = this.speed >= 100 ? Math.ceil(this.speed / 4) : Math.max(1, Math.round(this.speed / 10));
        const started = performance.now();
        let count = 0;
        while (count < target && performance.now() - started < budget && this.running && !this.locked) {
          const before = this.handsPlayed;
          this.stepFast();
          if (this.handsPlayed === before) break;
          count++;
        }
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : "The hand broke.";
      this.running = false;
    }
    this.emitMaybe();
    if (this.running && !this.locked) this.arm(delay);
  }

  private stepWatch(): number {
    if (this.resultHold) {
      this.resultHold = false;
      this.hand = null;
      return 420;
    }
    if (!this.hand) {
      if (!this.ensureMatch()) return 420;
      this.hand = new HandMachine({
        n: 6,
        button: this.live!.handsDone % 6,
        blinds: this.blinds,
        rng: this.rng,
        keepLog: true,
      });
      this.faced = Array.from({ length: 6 }, () => false);
      this.foldedTo = Array.from({ length: 6 }, () => false);
      this.agg = 0;
      this.passive = 0;
      return 360;
    }
    if (this.hand.phase === "next-street") {
      this.hand.advance();
      const phase = this.hand.phase as "act" | "next-street" | "done";
      return phase === "done" ? 700 : 420;
    }
    if (this.hand.phase === "done") {
      this.consumeMachine(this.hand);
      this.resultHold = true;
      return 880;
    }
    const seat = this.hand.actor;
    const ctx = this.hand.fillCtx(seat);
    const card = this.live!.seats[seat];
    if (card.bot) {
      ctx.ownElo = card.elo;
      ctx.oppAvgElo = card.oppAvg;
    }
    if (ctx.facingShove) this.faced[seat] = true;
    const decision = !card.bot || card.asKaiji
      ? kaijiDecision(ctx.hole0, ctx.hole1, ctx.board, ctx.street, ctx.toCall)
      : decideBot(card.bot, ctx, () => this.rng.next());
    if (decision.act === "fold" && ctx.facingShove) this.foldedTo[seat] = true;
    if (decision.act === "bet" || decision.act === "raise" || decision.act === "allin") this.agg++;
    else this.passive++;
    this.hand.act(seat, decision);
    const phase = this.hand.phase as "act" | "next-street" | "done";
    if (phase === "done") return 200;
    return 460;
  }

  private consumeMachine(hand: HandMachine): void {
    const result: HandResult = {
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
      facedShove: this.faced.slice(),
      foldedToShove: this.foldedTo.slice(),
      agg: this.agg,
      passive: this.passive,
    };
    this.applyResult(result);
  }

  private stepFast(): void {
    if (!this.ensureMatch()) return;
    const live = this.live!;
    const result = playHand({
      n: 6,
      button: live.handsDone % 6,
      blinds: this.blinds,
      rng: this.rng,
      keepLog: false,
      decide: (seat, ctx) => {
        const card = live.seats[seat];
        if (!card.bot || card.asKaiji) return kaijiDecision(ctx.hole0, ctx.hole1, ctx.board, ctx.street, ctx.toCall);
        ctx.ownElo = card.elo;
        ctx.oppAvgElo = card.oppAvg;
        return decideBot(card.bot, ctx, () => this.rng.next());
      },
    });
    this.hand = null;
    this.applyResult(result);
  }

  private ensureMatch(): boolean {
    if (this.locked) return false;
    if (this.live && this.live.handsDone < HANDS_PER_MATCH) return true;
    if (this.matchesCompleted >= this.matchDeadline) {
      this.lock("match");
      return false;
    }
    if (this.handsPlayed >= this.handDeadline) {
      this.lock("hand");
      return false;
    }
    const seats = drawSeats(this.field!, this.kaijiElo, this.rng);
    this.previewSeats = seats;
    this.live = { index: this.matchesCompleted, handsDone: 0, nets: [0, 0, 0, 0, 0, 0], seats };
    return true;
  }

  private applyResult(result: HandResult): void {
    const live = this.live;
    if (!live) return;
    if (this.blindMark === null) this.blindMark = this.blinds;
    else if (this.blindMark !== this.blinds) this.blindsMixed = true;
    this.preview = result;
    for (let i = 0; i < 6; i++) {
      live.nets[i] += result.nets[i];
      const card = live.seats[i];
      if (!card.bot) this.kaijiChips += result.nets[i];
      else {
        this.tierChips[card.bot.tier] += result.nets[i];
        this.teamChips[card.team] += result.nets[i];
        if (card.asKaiji) continue;
        learnFromHand(card.bot, {
          showdown: result.showdown && !result.folded[i],
          facedShove: result.facedShove[i],
          foldedToShove: result.foldedToShove[i],
          agg: result.agg,
          passive: result.passive,
        });
      }
    }
    this.displayNets = live.nets.slice();
    this.handsPlayed++;
    live.handsDone++;
    if (live.handsDone >= HANDS_PER_MATCH) {
      this.finishMatch();
      return;
    }
    if (this.handsPlayed >= this.handDeadline) this.lock("hand");
  }

  private historyPoint(): HistoryPoint {
    return {
      match: this.matchesCompleted,
      hands: this.handsPlayed,
      kaiji: this.kaijiElo,
      teams: this.field ? teamMeans(this.field, this.kaijiElo) : [this.kaijiElo],
      tiers: this.field ? tierMeans(this.field.bots) : { gto: INITIAL_ELO, dynamic: INITIAL_ELO, frozen: INITIAL_ELO, agentic: INITIAL_ELO },
      kaijiChips: this.kaijiChips,
      tierChips: { ...this.tierChips },
    };
  }

  private finishMatch(): void {
    const live = this.live;
    if (!live || !this.field) return;
    const ratings = live.seats.map((seat) => seat.elo);
    const next = eloUpdates(ratings, placementScores(live.nets));
    let kaijiPlayed = false;
    for (let i = 0; i < live.seats.length; i++) {
      const bot = live.seats[i].bot;
      if (!bot) {
        this.kaijiElo = next[i];
        kaijiPlayed = true;
      } else {
        bot.elo = next[i];
        bot.matches += 1;
        live.seats[i].elo = next[i];
      }
    }
    if (kaijiPlayed) {
      const kaijiSeat = live.seats.findIndex((seat) => seat.bot === null);
      const best = Math.max(...live.nets);
      if (kaijiSeat >= 0 && live.nets[kaijiSeat] === best) this.kaijiWins++;
      this.kaijiMatches++;
    }
    this.matchesCompleted++;
    this.history.push(this.historyPoint());
    this.live = null;
    this.persist();
    if (this.matchesCompleted >= this.matchDeadline) this.lock("match");
  }

  private lock(reason: "match" | "hand"): void {
    if (this.locked) return;
    this.locked = true;
    this.lockReason = reason;
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.persist();
  }

  private persist(): void {
    if (!this.field) return;
    const elos: Record<string, number> = {};
    const botMatches: Record<string, number> = {};
    const agentic: SaveData["agentic"] = {};
    for (const bot of this.field.bots) {
      elos[bot.id] = bot.elo;
      if (bot.matches) botMatches[bot.id] = bot.matches;
      if (bot.tier === "agentic" && bot.memory.hands > 0) agentic[bot.id] = bot.memory;
    }
    const data: SaveData = {
      v: 2,
      initialElo: INITIAL_ELO,
      seed: this.seed,
      teamCount: this.field.teamCount,
      botCount: this.field.botCount,
      kaijiShare: this.kaijiShare,
      blinds: this.blinds,
      blindsMixed: this.blindsMixed,
      matchDeadline: this.matchDeadline,
      handDeadline: this.handDeadline,
      matchesCompleted: this.matchesCompleted,
      handsPlayed: this.handsPlayed,
      kaijiMatches: this.kaijiMatches,
      kaijiWins: this.kaijiWins,
      winrateFrom: this.winrateFrom,
      kaijiElo: this.kaijiElo,
      kaijiChips: this.kaijiChips,
      tierChips: this.tierChips,
      teamChips: this.teamChips,
      rngState: this.rng.getState(),
      elos,
      botMatches,
      agentic,
      history: this.history,
      poolHistory: true,
      meanHistory: true,
      locked: this.locked,
      lockReason: this.lockReason,
    };
    try {
      writeSave(data);
    } catch {
      this.notice = "The browser refused to store the ladder. This run lives until you close the tab.";
    }
  }

  private emit(): void {
    this.lastEmit = performance.now();
    for (const listener of this.listeners) listener();
  }

  private emitMaybe(): void {
    const now = performance.now();
    if (this.speed <= 1 || this.locked || !this.running || now - this.lastEmit > 140) this.emit();
  }

  wipeSaved(): void {
    clearSave();
  }
}
