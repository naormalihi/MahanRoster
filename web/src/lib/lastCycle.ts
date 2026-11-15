/**
 * The last published cycle as a reference on the soldiers screen: each soldier's points there,
 * and a summary per service type (חובה / קבע) over the soldiers who were in it.
 */
import type { Cycle } from "./cycles";
import type { DraftAssignment } from "./draft";

const GONE = ["dropped", "swapped_out", "cancelled_approved"];

/** The latest cycle that was published (or closed), by its start. */
export function lastPublishedCycle(cycles: Cycle[]): Cycle | undefined {
  return cycles
    .filter((c) => c.status === "published" || c.status === "closed")
    .sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
}

/** Points and duties per soldier: the performer roles that stood. */
export function cycleScores(assignments: DraftAssignment[]): Map<string, { points: number; duties: number }> {
  const m = new Map<string, { points: number; duties: number }>();
  for (const a of assignments) {
    if (a.role !== "performer" || GONE.includes(a.status)) continue;
    const l = m.get(a.soldier_id) ?? { points: 0, duties: 0 };
    l.points += Number(a.normalized_points);
    l.duties += 1;
    m.set(a.soldier_id, l);
  }
  return m;
}

export interface ScoreSummary {
  key: string;
  n: number;
  mean: number;
  min: number;
  max: number;
  /** soldiers of the cycle with no duty at all */
  zero: number;
}

/** Mean, range and zeros per group, over the soldiers who were in the cycle (none = 0). */
export function summarize(members: { soldier_id: string; group: string }[], scores: Map<string, { points: number }>): ScoreSummary[] {
  const by = new Map<string, number[]>();
  for (const m of members) by.set(m.group, [...(by.get(m.group) ?? []), scores.get(m.soldier_id)?.points ?? 0]);
  return [...by.entries()]
    .map(([key, v]) => ({
      key,
      n: v.length,
      mean: v.reduce((s, x) => s + x, 0) / v.length,
      min: Math.min(...v),
      max: Math.max(...v),
      zero: v.filter((x) => x === 0).length,
    }))
    .sort((a, b) => b.n - a.n);
}

/** The cycle today falls in, if any. */
export function currentCycle(cycles: Cycle[], today: string): Cycle | undefined {
  return cycles.find((c) => c.start_date <= today && today <= c.end_date);
}

/** The first cycle that starts after today. */
export function nextCycle(cycles: Cycle[], today: string): Cycle | undefined {
  return cycles.filter((c) => c.start_date > today).sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
}

/** A board people see: published or closed. Anything else is still a draft. */
export const isPublished = (c: Cycle) => c.status === "published" || c.status === "closed";

/**
 * The "current" score on the soldiers screen: a new soldier's opening score plus his points in
 * the cycle today falls in. null = nothing to show (no current cycle and no opening score).
 */
export function currentScore(
  opening: number | null | undefined,
  inCycle: { points: number; duties: number } | undefined,
  hasCycle: boolean,
): { points: number; duties: number; opening: number } | null {
  const o = opening ? Number(opening) : 0;
  if (!hasCycle && !o) return null;
  return { points: o + (inCycle?.points ?? 0), duties: inCycle?.duties ?? 0, opening: o };
}
