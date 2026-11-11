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
