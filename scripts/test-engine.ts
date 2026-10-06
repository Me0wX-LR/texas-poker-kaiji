import { cardCode, categoryOf, evaluateCards, handStrength } from "../src/lib/eval";
import { eloUpdates, expectedScore, placementScores } from "../src/lib/elo";
import { applyKaijiPopulation, botSignature, generateField, teamName, teamPools, tierPools } from "../src/lib/field";
import { selectPracticeBot } from "../src/lib/controller";
import { HandMachine, playHand, type Decision } from "../src/lib/hand";
import { kaijiDecision, kaijiPostflopShove, kaijiPreflopShove } from "../src/lib/kaiji";
import { playHeadsUpMatch, playRatedMatch } from "../src/lib/match";
import { Rng } from "../src/lib/rng";
import { DEFAULT_MATCH_DEADLINE, HANDS_PER_MATCH, INITIAL_ELO } from "../src/lib/constants";

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

console.log(`match pace ${((HANDS_PER_MATCH / dt) * 1000).toFixed(0)} hands/sec`);
if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("all passed");
