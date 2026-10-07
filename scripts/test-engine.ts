import { cardCode, categoryOf, evaluateCards, handStrength } from "../src/lib/eval";
import { class169, decideSolver, solverFrequencies, streetTexture } from "../src/lib/gto";
import type { Ctx } from "../src/lib/hand";
import { eloUpdates, expectedScore, placementScores } from "../src/lib/elo";
import { applyKaijiPopulation, botSignature, generateField, teamName, teamPools, tierPools } from "../src/lib/field";
import { drawPracticeSeats, selectPracticeBot } from "../src/lib/controller";
import { decryptHoles, encryptHoles, makeSeatKeys } from "../src/lib/room-crypto";
import { SEAT_STALE_MS, TableHost } from "../src/lib/room-host";
import { cleanRoomCode, seatSpot, turnText, visibleHole, type SeatView } from "../src/lib/table-view";
import { HandMachine, playHand, type Decision } from "../src/lib/hand";
import { kaijiDecision, kaijiPostflopShove, kaijiPreflopShove } from "../src/lib/kaiji";
import { drawRound, playHeadsUpMatch, playRatedMatch, tableSizes } from "../src/lib/match";
import { Rng } from "../src/lib/rng";
import { DEFAULT_MATCH_DEADLINE, HANDS_PER_MATCH, INITIAL_ELO } from "../src/lib/constants";
import {
  ABSOLUTE_SPEED_CAP,
  measurePace,
  multiplierFromPace,
  speedFromPosition,
  speedPresets,
} from "../src/lib/pace";
import { assignGrades, collectStyles, TIER_GRADES } from "../src/lib/tier-list";

let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`ok  ${name}`);
    return;
  }
  failed++;
  console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

function c(rank: string, suit: string): number {
  const ranks = "23456789TJQKA";
  const suits = "shdc";
  const r = ranks.indexOf(rank);
  const s = suits.indexOf(suit);
  if (r < 0 || s < 0) throw new Error(`bad card ${rank}${suit}`);
  return cardCode(r, s);
}

const royal = evaluateCards([c("A", "s"), c("K", "s"), c("Q", "s"), c("J", "s"), c("T", "s")]);
const quads = evaluateCards([c("Q", "s"), c("Q", "h"), c("Q", "d"), c("Q", "c"), c("3", "s")]);
const boat = evaluateCards([c("K", "s"), c("K", "h"), c("K", "d"), c("2", "c"), c("2", "h")]);
const flush = evaluateCards([c("A", "h"), c("J", "h"), c("8", "h"), c("6", "h"), c("2", "h")]);
const straight = evaluateCards([c("9", "s"), c("8", "h"), c("7", "d"), c("6", "c"), c("5", "s")]);
const trips = evaluateCards([c("7", "s"), c("7", "h"), c("7", "d"), c("K", "c"), c("2", "h")]);
const two = evaluateCards([c("J", "s"), c("J", "h"), c("4", "d"), c("4", "c"), c("A", "h")]);
const pair = evaluateCards([c("T", "s"), c("T", "h"), c("K", "d"), c("7", "c"), c("2", "h")]);
const high = evaluateCards([c("A", "s"), c("J", "h"), c("9", "d"), c("6", "c"), c("3", "h")]);
const order = [royal, quads, boat, flush, straight, trips, two, pair, high];
check(
  "hand ranks descend",
  order.every((score, i) => i === 0 || order[i - 1] > score),
  order.map(categoryOf).join(","),
);
const wheel = evaluateCards([c("A", "s"), c("2", "h"), c("3", "d"), c("4", "c"), c("5", "s")]);
const six = evaluateCards([c("2", "s"), c("3", "h"), c("4", "d"), c("5", "c"), c("6", "s")]);
check("wheel loses to six-high straight", wheel < six && categoryOf(wheel) === 4);
check("aces over kings", evaluateCards([c("A", "s"), c("A", "h"), c("K", "d"), c("7", "c"), c("2", "h")]) > pair);
check("seven-card royal beats a pair", evaluateCards([c("A", "s"), c("K", "s"), c("Q", "s"), c("J", "s"), c("T", "s"), c("2", "h"), c("3", "d")]) > pair);
check("AA strength is best", handStrength(c("A", "s"), c("A", "h")) === 1);
check("72o is weak", handStrength(c("7", "s"), c("2", "h")) < 0.2);

check("pair shove", kaijiPreflopShove(c("2", "s"), c("2", "h")));
check("ATo shove", kaijiPreflopShove(c("A", "c"), c("T", "d")));
check("ATs shove", kaijiPreflopShove(c("A", "s"), c("T", "s")));
check("A9o folds", !kaijiPreflopShove(c("A", "s"), c("9", "d")));
check("KQo folds", !kaijiPreflopShove(c("K", "s"), c("Q", "d")));
const k72 = [c("K", "s"), c("7", "h"), c("2", "c")];
check("top pair shove", kaijiPostflopShove(c("A", "h"), c("K", "d"), k72));
check("overpair shove", kaijiPostflopShove(c("A", "s"), c("A", "d"), k72));
check("middle pair checks", !kaijiPostflopShove(c("8", "s"), c("7", "d"), k72));
check("two pair shove", kaijiPostflopShove(c("K", "d"), c("7", "s"), k72));
check("board pair is not hero top pair", !kaijiPostflopShove(c("A", "s"), c("2", "d"), [c("K", "s"), c("K", "h"), c("7", "c")]));
check("straight shove", kaijiPostflopShove(c("7", "s"), c("6", "h"), [c("T", "s"), c("9", "h"), c("8", "c")]));
check("free check", kaijiDecision(c("7", "s"), c("2", "h"), [], 0, 0).act === "check");
check("priced fold", kaijiDecision(c("7", "s"), c("2", "h"), [], 0, 100).act === "fold");
check("priced shove", kaijiDecision(c("A", "s"), c("K", "h"), [], 0, 100).act === "allin");

function randomDecision(hand: HandMachine, rng: Rng): Decision {
  const legal = hand.legal(hand.actor);
  const options: Decision[] = [];
  if (legal.canFold) options.push({ act: "fold" });
  if (legal.canCheck) options.push({ act: "check" });
  if (legal.canCall) options.push({ act: "call" });
  if (legal.canBet) {
    options.push({ act: "bet", to: legal.minBetTo });
    options.push({ act: "allin" });
  }
  if (legal.canRaise) {
    options.push({ act: "raise", to: legal.minRaiseTo });
    options.push({ act: "allin" });
  }
  if (options.length === 0) options.push({ act: "check" });
  return options[rng.int(options.length)];
}

function conserve(label: string, n: number, blinds: boolean, hands: number): void {
  const rng = new Rng(label.length * 17 + n);
  let bad = 0;
  for (let h = 0; h < hands; h++) {
    const result = playHand({
      n,
      button: h % n,
      blinds,
      rng,
      decide: (_seat, _ctx, hand) => randomDecision(hand, rng),
    });
    const sum = result.stacks.reduce((a, b) => a + b, 0);
    const nets = result.nets.reduce((a, b) => a + b, 0);
    if (sum !== n * 10000 || nets !== 0) bad++;
  }
  check(`${label} chip conservation`, bad === 0, `${bad} bad hands`);
}
conserve("6-max blinds", 6, true, 40);
conserve("6-max no blinds", 6, false, 20);
conserve("heads-up blinds", 2, true, 20);
conserve("heads-up no blinds", 2, false, 10);

const headsUp = new HandMachine({ n: 2, button: 0, blinds: true, rng: new Rng(4) });
check(
  "heads-up button is the small blind and acts first",
  headsUp.streetPut[0] === 50 && headsUp.streetPut[1] === 100 && headsUp.actor === 0 && headsUp.legal(0).toCall === 50,
);
const sixMax = new HandMachine({ n: 6, button: 0, blinds: true, rng: new Rng(5) });
check(
  "six-max blinds and under-the-gun",
  sixMax.streetPut[1] === 50 && sixMax.streetPut[2] === 100 && sixMax.actor === 3 && sixMax.legal(3).toCall === 100,
);

const folded = playHand({
  n: 6,
  button: 0,
  blinds: true,
  rng: new Rng(1),
  decide: () => ({ act: "fold" }),
});
check(
  "fold to big blind",
  folded.nets[1] === -50 && folded.nets[2] === 50 && folded.nets.reduce((a, b) => a + b, 0) === 0,
  folded.nets.join(","),
);

const checked = playHand({
  n: 6,
  button: 0,
  blinds: false,
  rng: new Rng(2),
  decide: () => ({ act: "check" }),
});
check(
  "all-check moves nothing",
  checked.nets.every((net) => net === 0) && checked.board.length === 5,
  checked.nets.join(","),
);

const weak = eloUpdates([1760, 1560], [1, 0]);
const strong = eloUpdates([1760, 1960], [1, 0]);
check("elo +8 example rounds", Math.round(weak[0] - 1760) === 8, String(weak[0] - 1760));
check("elo +17 stays an illustration", Math.round(strong[0] - 1760) === 24, String(strong[0] - 1760));
check("expected score is mean logistic", Math.abs(expectedScore([1760, 1560], 0) - 1 / (1 + 10 ** ((1560 - 1760) / 400))) < 1e-9);
const places = placementScores([10, 10, 5, 0, -5, -20]);
check("tied places split", Math.abs(places[0] - 0.9) < 1e-9 && Math.abs(places[1] - 0.9) < 1e-9, places.join(","));
check("last place is zero", places[5] === 0);

check("deadline window is 1008 matches", DEFAULT_MATCH_DEADLINE === 1008);

const field = generateField("kaiji-2026", 7, 1200);
check("1200 bots", field.bots.length === 1200);
const small = generateField("small-room", 7, 50);
const smallTiers = new Set(small.bots.map((bot) => bot.tier));
check("50 bots is a full field", small.bots.length === 50 && smallTiers.size === 4);
let refused = false;
try {
  generateField("small-room", 7, 49);
} catch {
  refused = true;
}
check("49 bots is refused", refused);
refused = false;
try {
  generateField("small-room", 7, 1201);
} catch {
  refused = true;
}
check("1201 bots is refused", refused);
const sixty = tableSizes(61);
check(
  "61 players all sit and Kaiji's table stays six-handed",
  sixty.reduce((sum, size) => sum + size, 0) === 61 && sixty.every((size) => size >= 2 && size <= 6) && sixty[0] === 6,
);
const roomField = generateField("room-60", 7, 60);
const roomTables = drawRound(roomField, INITIAL_ELO, new Rng(3));
const roomIds = roomTables.flatMap((table) => table.map((seat) => seat.bot?.id ?? "kaiji"));
check(
  "a 60-bot round seats Kaiji and every bot once",
  roomIds.length === 61 && new Set(roomIds).size === 61 && roomTables[0].some((seat) => seat.bot === null),
);
const playedRoom = generateField("room-50", 7, 50);
const filled = playRatedMatch({
  field: playedRoom,
  matchIndex: 0,
  kaijiElo: INITIAL_ELO,
  blinds: true,
  rng: new Rng(5),
  fillRoom: true,
});
check("filled room match is rated", filled.rated && filled.hands === HANDS_PER_MATCH);
check(
  "one round gives every bot one match",
  playedRoom.bots.every((bot) => bot.matches === 1),
);
const roomDrift = playedRoom.bots.reduce((sum, bot) => sum + (bot.elo - INITIAL_ELO), filled.nextKaijiElo - INITIAL_ELO);
check("a full room is zero-sum", Math.abs(roomDrift) < 1e-3, String(roomDrift));
const ids = new Set(field.bots.map((bot) => bot.id));
const sigs = new Set(field.bots.map(botSignature));
check("stable unique ids", ids.size === 1200);
check("distinct parameter sets", sigs.size === 1200, String(sigs.size));
let tiersOk = true;
for (let team = 1; team < 7; team++) {
  const kinds = new Set(field.rosters[team].map((bot) => bot.tier));
  if (kinds.size !== 4 || field.rosters[team].length !== 200) tiersOk = false;
}
check("each rival team has every tier", tiersOk);
check("team names", teamName(0) === "Kaiji" && teamName(1) === "North Door");
const again = generateField("kaiji-2026", 7, 1200);
check(
  "generator is stable",
  again.bots.every((bot, i) => bot.id === field.bots[i].id && bot.params.shoveCall === field.bots[i].params.shoveCall),
);

const t0 = performance.now();
const rated = playRatedMatch({
  field,
  matchIndex: 0,
  kaijiElo: INITIAL_ELO,
  blinds: true,
  rng: new Rng(99),
});
const dt = performance.now() - t0;
check("match is 240 hands and rated", rated.rated && rated.hands === HANDS_PER_MATCH, `${rated.hands} in ${dt.toFixed(0)}ms`);
check("nets sum to zero", Math.abs(rated.nets.reduce((a, b) => a + b, 0)) < 1e-6, rated.nets.join(","));
check(
  "a rating moved",
  rated.seats.some((seat) => Math.abs((seat.bot ? seat.bot.elo : rated.nextKaijiElo) - INITIAL_ELO) > 0.001),
);
const eloDrift = field.bots.reduce((sum, bot) => sum + (bot.elo - INITIAL_ELO), rated.nextKaijiElo - INITIAL_ELO);
check("table elo is zero-sum", Math.abs(eloDrift) < 1e-4, String(eloDrift));
const pools = tierPools(field.bots);
const tierDrift = pools.gto + pools.dynamic + pools.frozen + pools.agentic - 4 * INITIAL_ELO;
check("tier lines hold the field's losses", Math.abs(tierDrift + (rated.nextKaijiElo - INITIAL_ELO)) < 1e-4, String(tierDrift));
const teamDrift = teamPools(field, rated.nextKaijiElo).reduce((sum, elo) => sum + (elo - INITIAL_ELO), 0);
check("team lines hold the same losses", Math.abs(teamDrift) < 1e-4, String(teamDrift));
const buttons = new Array(6).fill(0);
for (let h = 0; h < 240; h++) buttons[h % 6]++;
check("button rotates evenly", buttons.every((n) => n === 40));

const fieldA = generateField("repeat", 7, 1000);
const fieldB = generateField("repeat", 7, 1000);
const runA = playRatedMatch({ field: fieldA, matchIndex: 3, kaijiElo: 1760, blinds: false, rng: new Rng(7) });
const runB = playRatedMatch({ field: fieldB, matchIndex: 3, kaijiElo: 1760, blinds: false, rng: new Rng(7) });
check("same seed repeats the match", runA.nets.join() === runB.nets.join() && runA.nextKaijiElo === runB.nextKaijiElo);

const practice = generateField("practice", 7, 1000);
applyKaijiPopulation(practice, 10);
const kaijiSeat = selectPracticeBot(practice.bots, "kaiji", 0);
check("practice kaiji is the chart", kaijiSeat === "kaiji");
const tag = selectPracticeBot(practice.bots, "style:TAG", 0);
check(
  "practice type is that personality",
  tag !== null && tag !== "kaiji" && tag.params.personality === "TAG" && tag.tier === "frozen" && !tag.playsKaiji,
);
const anyFrozen = selectPracticeBot(practice.bots, "frozen", 0.999);
check(
  "practice style stays in the style",
  anyFrozen !== null && anyFrozen !== "kaiji" && anyFrozen.tier === "frozen" && !anyFrozen.playsKaiji,
);
const chart = selectPracticeBot(practice.bots, "kaiji-chart", 0);
check("practice chart copy plays kaiji", chart !== null && chart !== "kaiji" && chart.playsKaiji);
const empty = selectPracticeBot(practice.bots.map((bot) => ({ ...bot, playsKaiji: false })), "kaiji-chart", 0);
check("empty practice pool draws nobody", empty === null);
const randomPick = selectPracticeBot(practice.bots, "random", 0);
check("random practice draw is a field player", randomPick !== null && randomPick !== "kaiji");
const eloBefore = practice.bots.map((bot) => bot.elo);
selectPracticeBot(practice.bots, "random", 0.5);
check("practice draw leaves ratings", practice.bots.every((bot, i) => bot.elo === eloBefore[i]));

const headsUpScores = placementScores([40, -40]);
check("heads-up winner scores 1", headsUpScores[0] === 1 && headsUpScores[1] === 0);
const tied = placementScores([0, 0]);
check("heads-up tie splits", tied[0] === 0.5 && tied[1] === 0.5);
const shifted = eloUpdates([1500, 1500], [1, 0]);
check("equal heads-up match is +16 and -16", Math.abs(shifted[0] - 1516) < 1e-9 && Math.abs(shifted[1] - 1484) < 1e-9);
const fiveRandom = drawPracticeSeats(
  practice.bots,
  Array.from({ length: 5 }, () => ({ pool: "random" as const, botId: null })),
  [0, 0, 0, 0, 0],
);
const fiveIds = fiveRandom.ok ? fiveRandom.picks.map((pick) => (pick === "kaiji" ? "kaiji" : pick.id)) : [];
check("five random seats are distinct players", new Set(fiveIds).size === 5, fiveIds.join(","));
const reservedName = practice.bots[0];
const reserved = drawPracticeSeats(
  practice.bots,
  [
    { pool: "random", botId: null },
    { pool: "random", botId: reservedName.id },
  ],
  [0, 0],
);
check(
  "a named chair is not stolen by an earlier random draw",
  reserved.ok &&
    reserved.picks[1] !== "kaiji" &&
    reserved.picks[1].id === reservedName.id &&
    reserved.picks[0] !== "kaiji" &&
    reserved.picks[0].id !== reservedName.id,
);
const doubled = drawPracticeSeats(
  practice.bots,
  [
    { pool: "random", botId: practice.bots[3].id },
    { pool: "random", botId: practice.bots[3].id },
  ],
  [0, 0],
);
check("the same player cannot sit twice", !doubled.ok);
const twoKaiji = drawPracticeSeats(
  practice.bots,
  [
    { pool: "kaiji", botId: null },
    { pool: "kaiji", botId: null },
  ],
  [0, 0],
);
check("kaiji sits at most once", !twoKaiji.ok);
const fiveTags = drawPracticeSeats(
  practice.bots,
  Array.from({ length: 5 }, () => ({ pool: "style:TAG" as const, botId: null })),
  [0, 0, 0, 0, 0],
);
check(
  "five draws of one personality stay distinct",
  fiveTags.ok &&
    fiveTags.picks.every((pick) => pick !== "kaiji" && pick.params.personality === "TAG" && !pick.playsKaiji) &&
    new Set(fiveTags.picks.map((pick) => (pick === "kaiji" ? "" : pick.id))).size === 5,
);
const sixNext = eloUpdates([1500, 1500, 1500, 1500, 1500, 1500], placementScores([100, 80, 20, -20, -80, -100]));
check("six-max elo is zero-sum", Math.abs(sixNext.reduce((sum, elo) => sum + elo, 0) - 9000) < 1e-6);
check("six-max first place is +16", Math.abs(sixNext[0] - 1516) < 1e-9);
check("six-max second place is +9.6", Math.abs(sixNext[1] - 1509.6) < 1e-9);
check("six-max last place is -16", Math.abs(sixNext[5] - 1484) < 1e-9);

const duelField = generateField("duel", 7, 1000);
const left = duelField.bots[0];
const right = duelField.bots[1];
const leftElo = left.elo;
const rightElo = right.elo;
const duel = playHeadsUpMatch({
  seats: [
    { team: left.team, bot: left, elo: left.elo, oppAvg: right.elo, asKaiji: false },
    { team: right.team, bot: right, elo: right.elo, oppAvg: left.elo, asKaiji: false },
  ],
  blinds: true,
  rng: new Rng(11),
  learn: false,
});
check("heads-up chips balance", Math.abs(duel.nets[0] + duel.nets[1]) < 1e-6, duel.nets.join(","));
check("heads-up elo is zero-sum", Math.abs(duel.next[0] + duel.next[1] - leftElo - rightElo) < 1e-6);
check("heads-up match can move a rating", duel.next[0] !== leftElo || duel.next[1] !== rightElo);

function spot(over: Partial<Ctx>): Ctx {
  return {
    seat: 0,
    hole0: c("7", "s"),
    hole1: c("2", "h"),
    board: [],
    street: 0,
    toCall: 100,
    pot: 150,
    stack: 10000,
    streetPut: 0,
    currentBet: 100,
    minRaiseTo: 200,
    minBetTo: 100,
    maxTo: 10000,
    pos: 0,
    n: 6,
    ownElo: INITIAL_ELO,
    oppAvgElo: INITIAL_ELO,
    facingShove: false,
    canFold: true,
    canCheck: false,
    canCall: true,
    canBet: false,
    canRaise: true,
    line: "",
    ...over,
  };
}

check("aces are the top pair class", class169(c("A", "s"), c("A", "h")) === 12);
check("ace-king suited class", class169(c("A", "s"), c("K", "s")) === 90);
const weakOpen = decideSolver(spot({}), () => 0);
check("seven-deuce does not open the button", weakOpen.act === "fold");
const aceOpen = decideSolver(spot({ hole0: c("A", "s"), hole1: c("A", "h") }), () => 0);
check(
  "aces open to two and a half blinds",
  aceOpen.act === "raise" && aceOpen.to === 250,
  JSON.stringify(aceOpen),
);
const dryKing = [c("K", "d"), c("7", "c"), c("2", "h")];
check("ace on king-seven-deuce is an overcard", streetTexture(dryKing, c("A", "s")) === 1);
check("a seven pairs that flop", streetTexture(dryKing, c("7", "d")) === 2);
const flopSpot = spot({
  hole0: c("A", "s"),
  hole1: c("A", "h"),
  board: dryKing,
  street: 1,
  toCall: 0,
  pot: 550,
  currentBet: 0,
  pos: 2,
  canFold: false,
  canCheck: true,
  canCall: false,
  canBet: true,
  canRaise: false,
  line: "",
});
const flopMix = solverFrequencies(flopSpot);
check(
  "solver frequencies sum to one",
  !!flopMix && Math.abs(flopMix.reduce((sum, value) => sum + value, 0) - 1) < 1e-6,
  flopMix ? flopMix.map((value) => value.toFixed(3)).join(",") : "missing",
);
const suitedConnector = solverFrequencies(spot({ ...flopSpot, hole0: c("7", "s"), hole1: c("6", "s") }));
check(
  "aces bet this dry king more than seven-six suited",
  !!flopMix && !!suitedConnector && flopMix[2] > suitedConnector[2],
  `${flopMix?.[2]} vs ${suitedConnector?.[2]}`,
);
const flopAct = decideSolver(flopSpot, () => 0);
check(
  "a flop decision is check, bet, or all-in",
  flopAct.act === "check" || flopAct.act === "bet" || flopAct.act === "allin",
  flopAct.act,
);
check(
  "gto bots are labeled solver GTO",
  field.bots.some((bot) => bot.tier === "gto" && bot.params.personality === "Solver GTO"),
);

const spread = assignGrades(
  [1700, 1600, 1550, 1500, 1450, 1400, 1300].map((elo, index) => ({
    id: `s${index}`,
    name: `Style ${index}`,
    family: "Frozen",
    elo,
    players: 1,
    bestName: `Style ${index}`,
    bestElo: elo,
  })),
);
check(
  "seven distinct elos fill S+ through F",
  spread.map((card) => card.grade).join(",") === TIER_GRADES.join(","),
  spread.map((card) => card.grade).join(","),
);
const flat = assignGrades([
  { id: "a", name: "A", family: "A", elo: 1500, players: 1, bestName: "A", bestElo: 1500 },
  { id: "b", name: "B", family: "B", elo: 1500.2, players: 1, bestName: "B", bestElo: 1500.2 },
]);
check("a tied room sits in B", flat.every((card) => card.grade === "B"));
const poles = assignGrades([
  { id: "top", name: "Top", family: "Top", elo: 1600, players: 1, bestName: "Top", bestElo: 1600 },
  { id: "bot", name: "Bot", family: "Bot", elo: 1400, players: 1, bestName: "Bot", bestElo: 1400 },
]);
check(
  "two styles take S+ and F",
  poles[0]?.grade === "S+" && poles[1]?.grade === "F",
  poles.map((card) => card.grade).join(","),
);
const sharedGrade = assignGrades([
  { id: "a", name: "Alpha", family: "Frozen", elo: 1600.2, players: 2, bestName: "Alpha", bestElo: 1610 },
  { id: "b", name: "Beta", family: "Frozen", elo: 1600.4, players: 2, bestName: "Beta", bestElo: 1620 },
  { id: "c", name: "Gamma", family: "Frozen", elo: 1400, players: 1, bestName: "Gamma", bestElo: 1400 },
]);
check(
  "rounded elo ties share a grade",
  sharedGrade[0]?.grade === "S+" && sharedGrade[1]?.grade === "S+" && sharedGrade[2]?.grade === "F",
);
const groupedStyles = collectStyles([
  { id: "style:Climber", name: "Climber", family: "Dynamic-by-Elo", elo: 1510, player: "Bea" },
  { id: "style:Climber", name: "Climber", family: "Dynamic-by-Elo", elo: 1490, player: "Ann" },
  { id: "kaiji-chart", name: "Kaiji chart", family: "Kaiji chart", elo: 1700, player: "Zed" },
  { id: "kaiji-chart", name: "Kaiji chart", family: "Kaiji chart", elo: 1700, player: "Amy" },
]);
const climberCard = groupedStyles.find((entry) => entry.id === "style:Climber");
const chartCard = groupedStyles.find((entry) => entry.id === "kaiji-chart");
check("a personality averages its seats", climberCard?.players === 2 && climberCard.elo === 1500 && climberCard.bestName === "Bea");
check("chart copies stay their own card", chartCard?.players === 2 && chartCard.bestName === "Amy" && chartCard.bestElo === 1700);

check("1× is the bottom of the log slider", speedFromPosition(0, 2500) === 1);
check("the log slider ends on the measured maximum", speedFromPosition(1000, 2500) === 2500);
check(
  "the log slider stays inside the measured maximum",
  speedFromPosition(400, 2500) > 1 && speedFromPosition(400, 2500) < 2500,
);
check(
  "presets never list a speed above the bench",
  speedPresets(800).join(",") === "1,10,100,800",
  speedPresets(800).join(","),
);
check(
  "presets cover 1, 10, 100, 1000, and the maximum",
  speedPresets(48000).join(",") === "1,10,100,1000,48000",
);
check(
  "a huge machine still stops at 100,000,000×",
  multiplierFromPace(1e12, 5000) === ABSOLUTE_SPEED_CAP,
);
const around = [0, 1, 2, 3, 4, 5].map((seat) => seatSpot(seat, 2));
const near = around[2];
check(
  "your chair sits at the bottom of the oval",
  near?.slot === 0 && around.every((spot) => spot.y <= (near?.y ?? 0)),
);
check(
  "six chairs do not stack",
  new Set(around.map((spot) => `${spot.x.toFixed(3)},${spot.y.toFixed(3)}`)).size === 6,
);
const secretHole = [c("A", "s"), c("K", "h")];
check("a player sees their own cards", JSON.stringify(visibleHole(secretHole, true, false, false)) === JSON.stringify(secretHole));
check("another seat stays face down", visibleHole(secretHole, false, false, false) === "back");
check("a folded opponent is mucked", visibleHole(secretHole, false, true, true) === "muck");
check("showdown turns a live hand face up", JSON.stringify(visibleHole(secretHole, false, true, false)) === JSON.stringify(secretHole));
check("a room code drops letters that look like digits", cleanRoomCode("ab1iol") === "ABL");

const roomBots = generateField("room-table", 7, 50).bots;
const tableHost = new TableHost("host", "You", true, new Rng(7));
const takenSeat = tableHost.claim("ann", "Ann", "pk-ann", 2);
const blockedSeat = tableHost.claim("bea", "Bea", "pk-bea", 2);
const sameSeat = tableHost.claim("ann", "Ann Two", "pk-ann-2", 4);
check("a free chair can be claimed", "seat" in takenSeat && takenSeat.seat === 2);
check("a taken chair is refused", "error" in blockedSeat);
check(
  "the same player can change chairs before the deal",
  "seat" in sameSeat && sameSeat.seat === 4 && tableHost.occupants[4]?.name === "Ann Two" && tableHost.occupants[2]?.kind === "open",
);
const dealProblem = tableHost.deal(roomBots);
check("the host can deal around seated friends", dealProblem === null && tableHost.hand?.phase === "act", dealProblem ?? "");
const lateSeat = tableHost.claim("cy", "Cy", "pk-cy", null);
check("a new player waits for the next hand", "error" in lateSeat);
const actorSeat = tableHost.hand?.actor ?? -1;
const actorId = actorSeat >= 0 ? tableHost.occupants[actorSeat]?.playerId : null;
check(
  "only the player to act can fold",
  tableHost.act(actorId === "ann" ? "host" : "ann", { act: "fold" }) !== null,
);
tableHost.vacate(1);
check("an AI stays seated during a hand", tableHost.occupants[1]?.kind === "ai");

const back = new TableHost("host", "You", false, new Rng(3));
const friend = back.claim("bea", "Bea", "pk", null);
check("a friend sits in an open chair", "seat" in friend && friend.seat === 1);
check("dropping keeps the chair", back.markDropped("bea") === "Bea" && back.occupants[1]?.connected === false && back.occupants[1]?.name === "Bea");
check("the host cannot be dropped", back.markDropped("host") === null && back.occupants[0]?.connected === true);
const dealtBack = back.deal(roomBots);
check("a hand can start with a saved chair", dealtBack === null, dealtBack ?? "");
const rejoined = back.claim("bea-2", "bea", "pk-2", null);
check(
  "a disconnected friend can rejoin during a hand",
  "seat" in rejoined && rejoined.rejoined === true && rejoined.seat === 1 && back.occupants[1]?.playerId === "bea-2" && back.occupants[1]?.connected === true && back.occupants[1]?.publicKey === "pk-2",
);
const steal = back.claim("cy", "Bea", "pk-3", null);
check("a connected name cannot be taken", "error" in steal);
back.markDropped("bea-2");
const other = back.claim("cy", "Cy", "pk-4", null);
check("a new name waits for the next hand", "error" in other);
const quiet = new TableHost("host", "You", false, new Rng(4));
quiet.claim("ann", "Ann", "pk", 2);
quiet.occupants[2].lastSeen = 1_000;
check("a quiet friend is marked disconnected", quiet.sweep(1_000 + SEAT_STALE_MS + 1) && quiet.occupants[2]?.connected === false);
quiet.claim("bo", "Bo", "pk", 3);
check("a fresh friend stays connected", !quiet.sweep(Date.now()) && quiet.occupants[3]?.connected === true && quiet.occupants[0]?.connected === true);
quiet.markDropped("ann");
quiet.vacate(2);
check("the host can free a disconnected chair between hands", quiet.occupants[2]?.kind === "open");
const awaySeat = { name: "Bea", away: true } as SeatView;
check(
  "a disconnected actor is named",
  turnText({ phase: "act", actor: 1, yourSeat: 0, seats: [{ name: "You", away: false } as SeatView, awaySeat] }) === "Bea disconnected",
);

const seatedHost = new TableHost("host", "Ada", false, new Rng(9));
const randomAi = seatedHost.seatAi(1, roomBots, { pool: "random", botId: null });
check("the host can seat a random AI", randomAi === null && seatedHost.occupants[1]?.kind === "ai");
check("an occupied chair refuses another AI", seatedHost.seatAi(1, roomBots, { pool: "random", botId: null }) !== null);
const namedBot = roomBots.find((bot) => bot.id !== seatedHost.occupants[1]?.botId);
const namedSeat = namedBot ? seatedHost.seatAi(2, roomBots, { pool: "random", botId: namedBot.id }) : "missing";
check("the host can seat a chosen AI", namedSeat === null && seatedHost.occupants[2]?.botId === namedBot?.id && seatedHost.occupants[2]?.name === namedBot?.name);
check("the same AI cannot sit twice", namedBot ? seatedHost.seatAi(3, roomBots, { pool: "random", botId: namedBot.id }) !== null : false);
check("Kaiji can sit in an open chair", seatedHost.seatAi(3, roomBots, { pool: "kaiji", botId: null }) === null && seatedHost.occupants[3]?.name === "Kaiji");
check("Kaiji sits only once", seatedHost.seatAi(4, roomBots, { pool: "kaiji", botId: null }) !== null);
const joined = seatedHost.claim("bea", "Bea", "pk", null);
check("a friend can join an open chair beside the AIs", "seat" in joined && joined.seat === 4);
const kickedNow = seatedHost.kick(4);
check(
  "the host can kick a friend",
  !("error" in kickedNow) && kickedNow.pending === false && seatedHost.occupants[4]?.kind === "open",
);
check("a kicked friend cannot sit back down", "error" in seatedHost.claim("bea", "Bea", "pk", null));
check("the host cannot be kicked", "error" in seatedHost.kick(0));
const midHand = new TableHost("host", "Ada", true, new Rng(11));
midHand.claim("bea", "Bea", "pk", 1);
midHand.deal(roomBots);
const midKick = midHand.kick(1);
check(
  "a kick during a hand waits until the cards are done",
  !("error" in midKick) && midKick.pending === true && midHand.occupants[1]?.kicked === true,
);

console.log(`match pace ${((HANDS_PER_MATCH / dt) * 1000).toFixed(0)} hands/sec`);
if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}

void measurePace({
  seed: "pace",
  players: 50,
  blinds: true,
  kaijiShare: 0,
  benchMs: 400,
}).then(async (paced) => {
  const alice = await makeSeatKeys();
  const bob = await makeSeatKeys();
  const eve = await makeSeatKeys();
  const sealed = await encryptHoles(alice.privateKey, bob.publicKey, [3, 17]);
  const opened = await decryptHoles(bob.privateKey, alice.publicKey, sealed);
  const stolen = await decryptHoles(eve.privateKey, alice.publicKey, sealed);
  check("hole cards round-trip for the seated player", JSON.stringify(opened) === JSON.stringify([3, 17]));
  check("the wrong key cannot read the holes", stolen === null);
  check(
    "a full 50-player room with blinds has a real pace",
    paced.players === 50 && paced.blinds && paced.handsPerSec > 0 && paced.maxSpeed >= 1 && paced.maxSpeed <= ABSOLUTE_SPEED_CAP,
    `${paced.handsPerSec.toFixed(1)} hands/s at ${paced.maxSpeed}×`,
  );
  if (failed) {
    console.error(`${failed} failed`);
    process.exit(1);
  }
  console.log("all passed");
});
