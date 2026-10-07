/** Grades for a finished run. S+ is the highest average Elo in that run. */
export const TIER_GRADES = ["S+", "S", "A", "B", "C", "D", "F"] as const;
export type TierGrade = (typeof TIER_GRADES)[number];

export interface StyleSample {
  id: string;
  name: string;
  family: string;
  elo: number;
  player: string;
}

export interface TierListEntry {
  id: string;
  name: string;
  family: string;
  elo: number;
  players: number;
  bestName: string;
  bestElo: number;
}

export interface TierListCard extends TierListEntry {
  grade: TierGrade;
}

/** Average one card per style. The best seat is the highest Elo, then the earlier name. */
export function collectStyles(samples: StyleSample[]): TierListEntry[] {
  const groups = new Map<string, { name: string; family: string; sum: number; players: number; bestName: string; bestElo: number }>();
  for (const sample of samples) {
    const existing = groups.get(sample.id);
    if (!existing) {
      groups.set(sample.id, {
        name: sample.name,
        family: sample.family,
        sum: sample.elo,
        players: 1,
        bestName: sample.player,
        bestElo: sample.elo,
      });
      continue;
    }
    existing.players += 1;
    existing.sum += sample.elo;
    const better = sample.elo > existing.bestElo;
    const tiedName = sample.elo === existing.bestElo && sample.player.localeCompare(existing.bestName) < 0;
    if (better || tiedName) {
      existing.bestElo = sample.elo;
      existing.bestName = sample.player;
    }
  }
  return [...groups.entries()].map(([id, group]) => ({
    id,
    name: group.name,
    family: group.family,
    elo: group.sum / group.players,
    players: group.players,
    bestName: group.bestName,
    bestElo: group.bestElo,
  }));
}

/**
 * Spread this run's styles from S+ down to F.
 * A single distinct Elo (after rounding) sits in B. Ties that round together share a grade.
 */
export function assignGrades(entries: TierListEntry[]): TierListCard[] {
  const ranked = entries.slice().sort((a, b) => b.elo - a.elo || a.name.localeCompare(b.name));
  const scores: number[] = [];
  for (const entry of ranked) {
    const score = Math.round(entry.elo);
    if (!scores.includes(score)) scores.push(score);
  }
  const count = scores.length;
  const gradeOf = new Map<number, TierGrade>();
  for (let index = 0; index < scores.length; index++) {
    const slot = count <= 1 ? 3 : Math.round((index / (count - 1)) * (TIER_GRADES.length - 1));
    gradeOf.set(scores[index], TIER_GRADES[slot]);
  }
  return ranked.map((entry) => ({
    ...entry,
    grade: gradeOf.get(Math.round(entry.elo)) ?? "B",
  }));
}
