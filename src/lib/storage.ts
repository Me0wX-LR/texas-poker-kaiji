import { INITIAL_ELO, type Tier } from "./constants";
import type { BotMemory } from "./policy";

export interface HistoryPoint {
  match: number;
  hands: number;
  kaiji: number;
  teams: number[];
  tiers: Record<Tier, number>;
  kaijiChips: number;
  tierChips: Record<Tier, number>;
}

export interface SaveData {
  v: 2;
  initialElo: number;
  seed: string;
  teamCount: number;
  botCount: number;
  /** Percent of bots who play Kaiji's chart. Older saves omit this and stay at 0. */
  kaijiShare?: number;
  blinds: boolean;
  blindsMixed: boolean;
  matchDeadline: number;
  handDeadline: number;
  matchesCompleted: number;
  handsPlayed: number;
  kaijiMatches: number;
  /** Rated matches in which Kaiji tied or took the best chip result. */
  kaijiWins?: number;
  /** kaijiMatches already finished before win tracking started. Older saves omit this. */
  winrateFrom?: number;
  kaijiElo: number;
  /** Heads-up rating for the person at the table. Older saves omit this and start at 1,500. */
  yourElo?: number;
  yourMatches?: number;
  kaijiChips: number;
  tierChips: Record<Tier, number>;
  teamChips: number[];
  rngState: number;
  elos: Record<string, number>;
  botMatches: Record<string, number>;
  agentic: Record<string, BotMemory>;
  history: HistoryPoint[];
  /** History points store table pools, not bench averages. Older saves omit this. */
  poolHistory?: boolean;
  /** Tier and team lines are average ratings, not the sum of a whole group. */
  meanHistory?: boolean;
  locked: boolean;
  lockReason: "match" | "hand" | null;
}

const KEY = "texas-poker-kaiji-v2";
const LEGACY_KEYS = ["texas-poker-kaiji-v1"];

export function loadSave(): SaveData | null {
  if (typeof localStorage === "undefined") return null;
  for (const legacy of LEGACY_KEYS) localStorage.removeItem(legacy);
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as SaveData;
  if (!parsed || parsed.v !== 2 || parsed.initialElo !== INITIAL_ELO || typeof parsed.seed !== "string") {
    localStorage.removeItem(KEY);
    return null;
  }
  return parsed;
}

export function writeSave(data: SaveData): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function clearSave(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(KEY);
}
