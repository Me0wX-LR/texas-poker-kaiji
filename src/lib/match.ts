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
  for (let i = 0; i < seats.length; i++) {
    let sum = 0;
    for (let j = 0; j < seats.length; j++) if (j !== i) sum += seats[j].elo;
    seats[i].oppAvg = sum / (seats.length - 1);
  }
  return seats;
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
  onHand?: (handIndex: number, result: HandResult, seats: SeatCard[]) => void;
}): RatedMatch {
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
