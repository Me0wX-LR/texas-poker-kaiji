import { INITIAL_ELO, MAX_BOTS, MAX_TEAMS, MIN_BOTS, MIN_TEAMS, TIERS, type Tier } from "./constants";
import { Bot, BotParams, emptyMemory } from "./policy";
import { Rng, hashString } from "./rng";

const LEFT = [
  "Ash", "Blind", "Cinder", "Dusk", "Echo", "Flint", "Grim", "Hush", "Ivory", "Jinx",
  "Kuro", "Lark", "Moth", "Nix", "Onyx", "Prowl", "Quartz", "Rook", "Sable", "Thorn",
  "Umber", "Vesper", "Wick", "Yomi", "Zinc", "Briar", "Cask", "Drift", "Ember", "Fable",
  "Gutter", "Halo", "Ink", "Jade", "Knell", "Loom", "Mirth", "Noir", "Ox", "Pike",
];

const RIGHT = [
  "Ace", "Bargain", "Cage", "Dagger", "Edge", "Fox", "Grin", "Halo", "Ichi", "Jack",
  "Knife", "Lamp", "Mask", "Needle", "Oath", "Pit", "Queen", "Razor", "Spade", "Token",
  "Urge", "Vein", "Wager", "Axiom", "Bite", "Chip", "Deal", "Flux", "Glove", "Hook",
  "Iris", "Joker", "Knot", "Lure", "Muse", "Nail", "Orbit", "Pawn", "Quill", "Rake",
];

const TEAM_NAMES = [
  "Kaiji",
  "North Door",
  "Lamp Row",
  "Back Booth",
  "Pit Rail",
  "Velvet Rope",
  "Last Call",
  "Side Exit",
  "Cold Room",
  "Red Felt",
  "Low Stair",
  "Iron Chair",
];

interface Style {
  personality: string;
  open: number;
  call: number;
  three: number;
  shove: number;
  bluff: number;
  agg: number;
  bet: number;
  value: number;
  pos: number;
}

const GTO_STYLE: Style = {
  personality: "Solver GTO",
  open: 0.62,
  call: 0.5,
  three: 0.74,
  shove: 0.66,
  bluff: 0.06,
  agg: 1,
  bet: 0.58,
  value: 0.04,
  pos: 0.85,
};

const DYNAMIC_STYLES: Style[] = [
  { personality: "Climber", open: 0.58, call: 0.46, three: 0.7, shove: 0.6, bluff: 0.08, agg: 1.05, bet: 0.56, value: 0.03, pos: 0.7 },
  { personality: "Bully", open: 0.5, call: 0.42, three: 0.62, shove: 0.52, bluff: 0.12, agg: 1.25, bet: 0.5, value: 0.01, pos: 0.8 },
  { personality: "Anchor", open: 0.68, call: 0.55, three: 0.8, shove: 0.72, bluff: 0.03, agg: 0.85, bet: 0.64, value: 0.06, pos: 0.4 },
];

const FROZEN_STYLES: Style[] = [
  { personality: "Tight-passive", open: 0.78, call: 0.58, three: 0.9, shove: 0.8, bluff: 0.01, agg: 0.62, bet: 0.7, value: 0.05, pos: 0.2 },
  { personality: "Loose-aggressive", open: 0.36, call: 0.3, three: 0.48, shove: 0.42, bluff: 0.16, agg: 1.4, bet: 0.4, value: 0, pos: 0.9 },
  { personality: "Calling station", open: 0.72, call: 0.18, three: 0.94, shove: 0.34, bluff: 0.01, agg: 0.5, bet: 0.74, value: -0.08, pos: 0.15 },
  { personality: "Maniac", open: 0.16, call: 0.2, three: 0.24, shove: 0.26, bluff: 0.28, agg: 1.7, bet: 0.28, value: -0.02, pos: 0.5 },
  { personality: "Nit", open: 0.84, call: 0.7, three: 0.92, shove: 0.84, bluff: 0, agg: 0.7, bet: 0.72, value: 0.08, pos: 0.1 },
  { personality: "Rock", open: 0.74, call: 0.6, three: 0.86, shove: 0.76, bluff: 0.02, agg: 0.75, bet: 0.66, value: 0.05, pos: 0.25 },
  { personality: "TAG", open: 0.64, call: 0.5, three: 0.74, shove: 0.64, bluff: 0.05, agg: 1.05, bet: 0.56, value: 0.03, pos: 0.6 },
  { personality: "LAG", open: 0.44, call: 0.36, three: 0.56, shove: 0.48, bluff: 0.14, agg: 1.3, bet: 0.46, value: 0.01, pos: 0.85 },
];

const AGENT_STYLES: Style[] = [
  { personality: "Watcher", open: 0.6, call: 0.48, three: 0.72, shove: 0.62, bluff: 0.07, agg: 1, bet: 0.56, value: 0.03, pos: 0.6 },
  { personality: "Counter", open: 0.54, call: 0.4, three: 0.66, shove: 0.55, bluff: 0.1, agg: 1.15, bet: 0.5, value: 0.02, pos: 0.75 },
  { personality: "Mimic", open: 0.48, call: 0.38, three: 0.6, shove: 0.5, bluff: 0.12, agg: 1.1, bet: 0.52, value: 0.01, pos: 0.7 },
];

/** Style buckets and the personalities inside them. Heads-up draws one player from a chosen row. */
export const PRACTICE_GROUPS: { tier: Tier; personalities: string[] }[] = [
  { tier: "gto", personalities: [GTO_STYLE.personality] },
  { tier: "dynamic", personalities: DYNAMIC_STYLES.map((style) => style.personality) },
  { tier: "frozen", personalities: FROZEN_STYLES.map((style) => style.personality) },
  { tier: "agentic", personalities: AGENT_STYLES.map((style) => style.personality) },
];

/** How many bots in the field are Kaiji. A whole percent of the population, from the start. */
export function kaijiPopulationCount(botCount: number, share: number): number {
  const pct = Math.max(0, Math.min(100, Math.round(Number.isFinite(share) ? share : 0)));
  return Math.round((botCount * pct) / 100);
}

/**
 * Mark exactly that percent of this field as Kaiji. The same seed and percent
 * always pick the same players, and a smaller percent is a subset of a larger one.
 */
export function applyKaijiPopulation(field: Field, share: number): number {
  const count = kaijiPopulationCount(field.bots.length, share);
  const order = field.bots.map((_, index) => index);
  const rng = new Rng(hashString(`${field.seed}:kaiji-pop`) ^ 0xc0ffee);
  for (let i = order.length - 1; i > 0; i--) {
    const swap = rng.int(i + 1);
    const hold = order[i];
    order[i] = order[swap];
    order[swap] = hold;
  }
  const chosen = new Set(order.slice(0, count));
  for (let i = 0; i < field.bots.length; i++) field.bots[i].playsKaiji = chosen.has(i);
  return count;
}

export function teamName(index: number): string {
  return TEAM_NAMES[index] ?? `Team ${index + 1}`;
}

export function botName(index: number): string {
  const base = `${LEFT[index % LEFT.length]} ${RIGHT[Math.floor(index / LEFT.length) % RIGHT.length]}`;
  const cycle = Math.floor(index / (LEFT.length * RIGHT.length));
  return cycle === 0 ? base : `${base} ${cycle + 1}`;
}

function jitter(rng: Rng, scale: number): number {
  return (rng.next() - 0.5) * 2 * scale;
}

function line(base: number, rng: Rng, scale: number, posSpread: number): number[] {
  const button = clamp01(base - 0.16 + jitter(rng, scale));
  const sb = clamp01(base - 0.06 + jitter(rng, scale));
  const bb = clamp01(base + jitter(rng, scale));
  const utg = clamp01(base + 0.14 + jitter(rng, scale));
  const hj = clamp01(base + 0.08 + jitter(rng, scale));
  const co = clamp01(base - 0.04 + jitter(rng, scale));
  const pull = posSpread;
  return [
    clamp01(button * pull + base * (1 - pull)),
    clamp01(sb * pull + base * (1 - pull)),
    clamp01(bb * pull + base * (1 - pull)),
    clamp01(utg * pull + base * (1 - pull)),
    clamp01(hj * pull + base * (1 - pull)),
    clamp01(co * pull + base * (1 - pull)),
  ];
}

function clamp01(value: number): number {
  if (value < 0.02) return 0.02;
  if (value > 0.98) return 0.98;
  return value;
}

function styleFor(tier: Tier, index: number): Style {
  if (tier === "gto") return GTO_STYLE;
  if (tier === "dynamic") return DYNAMIC_STYLES[index % DYNAMIC_STYLES.length];
  if (tier === "frozen") return FROZEN_STYLES[index % FROZEN_STYLES.length];
  return AGENT_STYLES[index % AGENT_STYLES.length];
}

function makeBot(tier: Tier, index: number, rng: Rng): Bot {
  const style = styleFor(tier, index);
  const eps = (index + 1) * 0.00001;
  const params: BotParams = {
    open: line(style.open, rng, 0.035, style.pos),
    call: line(style.call, rng, 0.04, style.pos * 0.8),
    threeBet: line(style.three, rng, 0.03, style.pos * 0.5),
    shoveCall: clamp01(style.shove + jitter(rng, 0.04) + eps),
    valueEdge: style.value + jitter(rng, 0.02),
    betEdge: clamp01(style.bet + jitter(rng, 0.04)),
    bluff: Math.min(0.45, Math.max(0, style.bluff + jitter(rng, 0.03) + eps)),
    agg: Math.min(2, Math.max(0.4, style.agg + jitter(rng, 0.12))),
    posSens: Math.min(1, Math.max(0, style.pos + jitter(rng, 0.1))),
    adapt: tier === "agentic" ? 0.35 + rng.next() * 0.65 : 0,
    eloTight: 0,
    eloAgg: 0,
    personality: style.personality,
  };
  if (tier === "dynamic") {
    params.eloTight = rng.next() < 0.7 ? 0.12 + rng.next() * 0.28 : -(0.1 + rng.next() * 0.2);
    params.eloAgg = rng.next() < 0.6 ? 0.15 + rng.next() * 0.45 : -(0.12 + rng.next() * 0.3);
  }
  params.open[0] = clamp01(params.open[0] + eps);
  return {
    id: `${tier}-${String(index).padStart(4, "0")}`,
    name: botName(index),
    tier,
    team: 0,
    elo: INITIAL_ELO,
    matches: 0,
    playsKaiji: false,
    params,
    memory: emptyMemory(),
  };
}

export interface Field {
  seed: string;
  teamCount: number;
  botCount: number;
  bots: Bot[];
  rosters: Bot[][];
}

export function validateField(teamCount: number, botCount: number): string | null {
  if (!Number.isInteger(teamCount) || teamCount < MIN_TEAMS || teamCount > MAX_TEAMS) {
    return `Use ${MIN_TEAMS} to ${MAX_TEAMS} teams so six seats can be filled.`;
  }
  if (!Number.isInteger(botCount) || botCount < MIN_BOTS || botCount > MAX_BOTS) {
    return `Use ${MIN_BOTS.toLocaleString("en-US")} to ${MAX_BOTS.toLocaleString("en-US")} players.`;
  }
  if (botCount < (teamCount - 1) * TIERS.length) {
    return "Not enough bots for every non-Kaiji team to hold every tier.";
  }
  return null;
}

export function generateField(seed: string, teamCount: number, botCount: number): Field {
  const problem = validateField(teamCount, botCount);
  if (problem) throw new Error(problem);
  const rng = new Rng(hashString(`${seed}:field`) ^ 0xa11ce);
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < botCount; i++) counts[i % 4]++;
  const rosters: Bot[][] = Array.from({ length: teamCount }, () => []);
  const bots: Bot[] = [];
  const nonKaiji = teamCount - 1;
  for (let t = 0; t < TIERS.length; t++) {
    const tier = TIERS[t];
    for (let i = 0; i < counts[t]; i++) {
      const bot = makeBot(tier, i, rng);
      bot.team = 1 + (i % nonKaiji);
      rosters[bot.team].push(bot);
      bots.push(bot);
    }
  }
  return { seed, teamCount, botCount, bots, rosters };
}

export function botSignature(bot: Bot): string {
  return [
    bot.params.open.map((n) => n.toFixed(5)).join(","),
    bot.params.shoveCall.toFixed(5),
    bot.params.bluff.toFixed(5),
    bot.params.agg.toFixed(5),
    bot.params.adapt.toFixed(5),
    bot.params.eloTight.toFixed(5),
    bot.params.eloAgg.toFixed(5),
    bot.params.posSens.toFixed(5),
    bot.params.personality,
  ].join("|");
}

export function tierMeans(bots: readonly Bot[]): Record<Tier, number> {
  const sum: Record<Tier, number> = { gto: 0, dynamic: 0, frozen: 0, agentic: 0 };
  const count: Record<Tier, number> = { gto: 0, dynamic: 0, frozen: 0, agentic: 0 };
  for (const bot of bots) {
    if (bot.matches <= 0) continue;
    sum[bot.tier] += bot.elo;
    count[bot.tier]++;
  }
  return {
    gto: count.gto ? sum.gto / count.gto : INITIAL_ELO,
    dynamic: count.dynamic ? sum.dynamic / count.dynamic : INITIAL_ELO,
    frozen: count.frozen ? sum.frozen / count.frozen : INITIAL_ELO,
    agentic: count.agentic ? sum.agentic / count.agentic : INITIAL_ELO,
  };
}

/** 1,500 plus every point this tier's seated bots have won or lost. Not a bench average. */
export function tierPools(bots: readonly Bot[]): Record<Tier, number> {
  const delta: Record<Tier, number> = { gto: 0, dynamic: 0, frozen: 0, agentic: 0 };
  for (const bot of bots) delta[bot.tier] += bot.elo - INITIAL_ELO;
  return {
    gto: INITIAL_ELO + delta.gto,
    dynamic: INITIAL_ELO + delta.dynamic,
    frozen: INITIAL_ELO + delta.frozen,
    agentic: INITIAL_ELO + delta.agentic,
  };
}

export function teamMeans(field: Field, kaijiElo: number): number[] {
  const means = [kaijiElo];
  for (let team = 1; team < field.teamCount; team++) {
    let sum = 0;
    let count = 0;
    for (const bot of field.rosters[team]) {
      if (bot.matches <= 0) continue;
      sum += bot.elo;
      count++;
    }
    means.push(count ? sum / count : INITIAL_ELO);
  }
  return means;
}

/** 1,500 plus every point that team's seated bots have won or lost. Kaiji stays his own rating. */
export function teamPools(field: Field, kaijiElo: number): number[] {
  const pools = [kaijiElo];
  for (let team = 1; team < field.teamCount; team++) {
    let delta = 0;
    for (const bot of field.rosters[team]) delta += bot.elo - INITIAL_ELO;
    pools.push(INITIAL_ELO + delta);
  }
  return pools;
}
