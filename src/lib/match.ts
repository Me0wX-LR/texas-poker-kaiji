import { HANDS_PER_MATCH } from "./constants";
import { eloUpdates, placementScores } from "./elo";
import type { Field } from "./field";
import { HandResult, playHand } from "./hand";
import { kaijiDecision } from "./kaiji";
import { Bot, decideBot, learnFromHand } from "./policy";
import type { Rng } from "./rng";

export interface SeatCard {
  team: number;
  bot: Bot | null;
  elo: number;
  oppAvg: number;
  /** This chair plays the static Kaiji chart for the match. The real Kaiji is always on it. */
  asKaiji: boolean;
}

export function seatedTeams(matchIndex: number, teamCount: number): number[] {
  const start = matchIndex % teamCount;
  const seats: number[] = [];
  for (let i = 0; i < 6; i++) seats.push((start + i) % teamCount);
  return seats;
}

export function drawSeats(field: Field, kaijiElo: number, rng: Rng): SeatCard[] {
  const seats: SeatCard[] = [{ team: 0, bot: null, elo: kaijiElo, oppAvg: 0, asKaiji: true }];
  const used = new Set<number>();
  while (seats.length < 6) {
    const index = rng.int(field.bots.length);
    if (used.has(index)) continue;
    used.add(index);
    const bot = field.bots[index];
    seats.push({ team: bot.team, bot, elo: bot.elo, oppAvg: 0, asKaiji: bot.playsKaiji });
  }
  return withOppAvg(seats);
}

/** Seat counts for one round. Nobody sits out. A leftover of one is folded into a 5-max and a heads-up. */
export function tableSizes(playerCount: number): number[] {
  if (playerCount < 2) return playerCount > 0 ? [playerCount] : [];
  const sizes: number[] = [];
  let left = playerCount;
  while (left >= 6) {
    sizes.push(6);
    left -= 6;
  }
  if (left === 0) return sizes;
  if (left === 1) {
    sizes[sizes.length - 1] = 5;
    sizes.push(2);
    return sizes;
  }
  sizes.push(left);
  return sizes;
}

/**
 * One round for the whole room. Table 0 is Kaiji plus five others when the room has at least six players.
 * Every other player sits at an AI table. The same seed deals the same seats.
 */
export function drawRound(field: Field, kaijiElo: number, rng: Rng): SeatCard[][] {
  const order = field.bots.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const swap = rng.int(i + 1);
    const hold = order[i];
    order[i] = order[swap];
    order[swap] = hold;
  }
  const sizes = tableSizes(order.length + 1);
  const tables: SeatCard[][] = [];
  let cursor = 0;
  for (let table = 0; table < sizes.length; table++) {
    const seats: SeatCard[] = [];
    if (table === 0) seats.push({ team: 0, bot: null, elo: kaijiElo, oppAvg: 0, asKaiji: true });
    while (seats.length < sizes[table]) {
      const bot = order[cursor++];
      seats.push({ team: bot.team, bot, elo: bot.elo, oppAvg: 0, asKaiji: bot.playsKaiji });
    }
    tables.push(withOppAvg(seats));
  }
  return tables;
}

function withOppAvg(seats: SeatCard[]): SeatCard[] {
  for (let i = 0; i < seats.length; i++) {
    let sum = 0;
    for (let j = 0; j < seats.length; j++) if (j !== i) sum += seats[j].elo;
    seats[i].oppAvg = seats.length === 1 ? seats[i].elo : sum / (seats.length - 1);
  }
  return seats;
}

/** One hand at a table of any size from 2 to 6. Chart copies do not learn. */
export function playTableHand(options: {
  seats: SeatCard[];
  handIndex: number;
  blinds: boolean;
  rng: Rng;
  learn: boolean;
}): number[] {
  const seats = options.seats;
  const n = seats.length;
  const result = playHand({
    n,
    button: options.handIndex % n,
    blinds: options.blinds,
    rng: options.rng,
    keepLog: false,
    decide: (seat, ctx) => {
      const card = seats[seat];
      if (!card.bot || card.asKaiji) return kaijiDecision(ctx.hole0, ctx.hole1, ctx.board, ctx.street, ctx.toCall);
      ctx.ownElo = card.elo;
      ctx.oppAvgElo = card.oppAvg;
      return decideBot(card.bot, ctx, () => options.rng.next());
    },
  });
  if (options.learn) {
    for (let i = 0; i < n; i++) {
      const bot = seats[i].bot;
      if (!bot || seats[i].asKaiji) continue;
      learnFromHand(bot, {
        showdown: result.showdown && !result.folded[i],
        facedShove: result.facedShove[i],
        foldedToShove: result.foldedToShove[i],
        agg: result.agg,
        passive: result.passive,
      });
    }
  }
  return result.nets;
}

/** Write a finished table back onto the bots. Returns Kaiji's new rating when he sat here. */
export function rateTable(seats: SeatCard[], nets: number[]): number | null {
  const next = eloUpdates(seats.map((seat) => seat.elo), placementScores(nets));
  let kaiji: number | null = null;
  for (let i = 0; i < seats.length; i++) {
    const bot = seats[i].bot;
    if (!bot) kaiji = next[i];
    else {
      bot.elo = next[i];
      bot.matches += 1;
      seats[i].elo = next[i];
    }
  }
  return kaiji;
}

export interface RatedMatch {
  rated: boolean;
  hands: number;
  nets: number[];
  seats: SeatCard[];
  kaijiPlayed: boolean;
  nextKaijiElo: number;
}

export function playRatedMatch(options: {
  field: Field;
  matchIndex: number;
  kaijiElo: number;
  blinds: boolean;
  rng: Rng;
  handLimit?: number;
  /** Seat and rate every player, not only Kaiji's table. */
  fillRoom?: boolean;
  onHand?: (handIndex: number, result: HandResult, seats: SeatCard[]) => void;
}): RatedMatch {
  if (options.fillRoom) return playFilledRoom(options);
  const seats = drawSeats(options.field, options.kaijiElo, options.rng);
  const nets = [0, 0, 0, 0, 0, 0];
  const limit = options.handLimit ?? HANDS_PER_MATCH;
  let hands = 0;
  for (; hands < limit; hands++) {
    const result = playHand({
      n: 6,
      button: hands % 6,
      blinds: options.blinds,
      rng: options.rng,
      keepLog: false,
      decide: (seat, ctx) => {
        const card = seats[seat];
        if (!card.bot || card.asKaiji) return kaijiDecision(ctx.hole0, ctx.hole1, ctx.board, ctx.street, ctx.toCall);
        ctx.ownElo = card.elo;
        ctx.oppAvgElo = card.oppAvg;
        return decideBot(card.bot, ctx, () => options.rng.next());
      },
    });
    for (let i = 0; i < 6; i++) nets[i] += result.nets[i];
    for (let i = 0; i < 6; i++) {
      const bot = seats[i].bot;
      if (!bot || seats[i].asKaiji) continue;
      learnFromHand(bot, {
        showdown: result.showdown && !result.folded[i],
        facedShove: result.facedShove[i],
        foldedToShove: result.foldedToShove[i],
        agg: result.agg,
        passive: result.passive,
      });
    }
    options.onHand?.(hands, result, seats);
  }
  const kaijiPlayed = seats.some((seat) => seat.bot === null);
  if (hands < HANDS_PER_MATCH) {
    return { rated: false, hands, nets, seats, kaijiPlayed, nextKaijiElo: options.kaijiElo };
  }
  const ratings = seats.map((seat) => seat.elo);
  const next = eloUpdates(ratings, placementScores(nets));
  let nextKaiji = options.kaijiElo;
  for (let i = 0; i < seats.length; i++) {
    const bot = seats[i].bot;
    if (!bot) nextKaiji = next[i];
    else {
      bot.elo = next[i];
      bot.matches += 1;
    }
  }
  return { rated: true, hands, nets, seats, kaijiPlayed, nextKaijiElo: nextKaiji };
}

function playFilledRoom(options: {
  field: Field;
  kaijiElo: number;
  blinds: boolean;
  rng: Rng;
  handLimit?: number;
}): RatedMatch {
  const tables = drawRound(options.field, options.kaijiElo, options.rng);
  const limit = options.handLimit ?? HANDS_PER_MATCH;
  const played = tables.map((seats) => {
    const nets = Array.from({ length: seats.length }, () => 0);
    for (let hand = 0; hand < limit; hand++) {
      const handNets = playTableHand({ seats, handIndex: hand, blinds: options.blinds, rng: options.rng, learn: true });
      for (let i = 0; i < handNets.length; i++) nets[i] += handNets[i];
    }
    return { seats, nets };
  });
  if (limit < HANDS_PER_MATCH) {
    return {
      rated: false,
      hands: limit,
      nets: played[0].nets,
      seats: played[0].seats,
      kaijiPlayed: true,
      nextKaijiElo: options.kaijiElo,
    };
  }
  let nextKaiji = options.kaijiElo;
  for (const table of played) {
    const kaiji = rateTable(table.seats, table.nets);
    if (kaiji !== null) nextKaiji = kaiji;
  }
  return {
    rated: true,
    hands: limit,
    nets: played[0].nets,
    seats: played[0].seats,
    kaijiPlayed: true,
    nextKaijiElo: nextKaiji,
  };
}

/** A full heads-up match. Ratings use the same K=32 formula as the six-max table. */
export function playHeadsUpMatch(options: {
  seats: [SeatCard, SeatCard];
  blinds: boolean;
  rng: Rng;
  learn: boolean;
}): { nets: [number, number]; next: [number, number] } {
  const seats = options.seats;
  const nets: [number, number] = [0, 0];
  for (let hands = 0; hands < HANDS_PER_MATCH; hands++) {
    const result = playHand({
      n: 2,
      button: hands % 2,
      blinds: options.blinds,
      rng: options.rng,
      keepLog: false,
      decide: (seat, ctx) => {
        const card = seats[seat];
        const other = seats[seat === 0 ? 1 : 0];
        if (!card.bot || card.asKaiji) return kaijiDecision(ctx.hole0, ctx.hole1, ctx.board, ctx.street, ctx.toCall);
        ctx.ownElo = card.elo;
        ctx.oppAvgElo = other.elo;
        return decideBot(card.bot, ctx, () => options.rng.next());
      },
    });
    nets[0] += result.nets[0];
    nets[1] += result.nets[1];
    if (!options.learn) continue;
    for (let i = 0; i < 2; i++) {
      const bot = seats[i].bot;
      if (!bot || seats[i].asKaiji) continue;
      learnFromHand(bot, {
        showdown: result.showdown && !result.folded[i],
        facedShove: result.facedShove[i],
        foldedToShove: result.foldedToShove[i],
        agg: result.agg,
        passive: result.passive,
      });
    }
  }
  const next = eloUpdates(
    [seats[0].elo, seats[1].elo],
    placementScores(nets),
  );
  return { nets, next: [next[0], next[1]] };
}
