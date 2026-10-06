export const STARTING_STACK = 10_000;
export const SMALL_BLIND = 50;
export const BIG_BLIND = 100;
export const HANDS_PER_MATCH = 240;
export const INITIAL_ELO = 1500;
export const ELO_K = 32;
export const ELO_DIVISOR = 400;
export const MIN_BOTS = 1000;
export const MIN_TEAMS = 6;
export const MAX_TEAMS = 12;
export const DEFAULT_TEAMS = 7;
export const DEFAULT_BOTS = 1200;
export const DEFAULT_SEED = "kaiji-2026";

/**
 * One poker match every 10 minutes from 5 Oct 2026 00:00 UTC through the
 * 23:50 UTC match on 11 Oct 2026. That is 7 days × 144 matches = 1,008.
 */
export const WINDOW_START_MS = Date.UTC(2026, 9, 5, 0, 0, 0);
export const MATCH_INTERVAL_MS = 10 * 60 * 1000;
export const DEFAULT_MATCH_DEADLINE = 7 * 24 * 6;
export const DEFAULT_HAND_DEADLINE = DEFAULT_MATCH_DEADLINE * HANDS_PER_MATCH;

export const TIERS = ["gto", "dynamic", "frozen", "agentic"] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_LABEL: Record<Tier, string> = {
  gto: "GTO-style",
  dynamic: "Dynamic-by-Elo",
  frozen: "Frozen",
  agentic: "Agentic adapters",
};

export function matchStartMs(index: number): number {
  return WINDOW_START_MS + index * MATCH_INTERVAL_MS;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatMatchTime(index: number): string {
  const d = new Date(matchStartMs(index));
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

export function formatChips(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${Math.round(n).toLocaleString("en-US")}`;
}

export function formatElo(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function asset(path: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return `${base}${path}`;
}
