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
}

export function seatedTeams(matchIndex: number, teamCount: number): number[] {
  const start = matchIndex % teamCount;
  const seats: number[] = [];
  for (let i = 0; i < 6; i++) seats.push((start + i) % teamCount);
  return seats;
}

export function drawSeats(field: Field, matchIndex: number, kaijiElo: number, rng: Rng): SeatCard[] {
  const teams = seatedTeams(matchIndex, field.teamCount);
  const seats: SeatCard[] = teams.map((team) => {
    if (team === 0) return { team, bot: null, elo: kaijiElo, oppAvg: 0 };
    const roster = field.rosters[team];
    const bot = roster[rng.int(roster.length)];
    return { team, bot, elo: bot.elo, oppAvg: 0 };
  });
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
  const seats = drawSeats(options.field, options.matchIndex, options.kaijiElo, options.rng);
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
        if (!card.bot) return kaijiDecision(ctx.hole0, ctx.hole1, ctx.board, ctx.street, ctx.toCall);
        ctx.ownElo = card.elo;
        ctx.oppAvgElo = card.oppAvg;
        return decideBot(card.bot, ctx, () => options.rng.next());
      },
    });
    for (let i = 0; i < 6; i++) nets[i] += result.nets[i];
    for (let i = 0; i < 6; i++) {
      const bot = seats[i].bot;
      if (!bot) continue;
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
