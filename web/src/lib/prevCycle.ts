/**
 * The previous cycle as a reference in the draft: each soldier's points there, and the mean of
 * a group of soldiers over those of them who were in that cycle.
 */
import type { Cycle } from "./cycles";
import type { DraftAssignment } from "./draft";

export interface PrevCycle {
  name: string;
  /** points and duties per soldier (performer roles that stood) */
  load: Map<string, { points: number; duties: number }>;
  /** the soldiers who were in that cycle (its snapshot) */
  members: Set<string>;
}

const GONE = ["dropped", "swapped_out", "cancelled_approved"];

/** The last published (or closed) cycle that started before this one. */
export function previousCycle(cycles: Cycle[], current: Cycle): Cycle | undefined {
  return cycles
    .filter((c) => c.id !== current.id && (c.status === "published" || c.status === "closed") && c.start_date < current.start_date)
    .sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
}

export function prevCycle(name: string, assignments: DraftAssignment[], members: string[]): PrevCycle {
  const load = new Map<string, { points: number; duties: number }>();
  for (const a of assignments) {
    if (a.role !== "performer" || GONE.includes(a.status)) continue;
    const l = load.get(a.soldier_id) ?? { points: 0, duties: 0 };
    l.points += Number(a.normalized_points);
    l.duties += 1;
    load.set(a.soldier_id, l);
  }
  return { name, load, members: new Set(members) };
}

/** Mean points in the previous cycle of those of `ids` who were in it (with a zero for none). */
export function prevMean(prev: PrevCycle, ids: string[]): { mean: number; n: number } | null {
  const was = ids.filter((id) => prev.members.has(id));
  if (!was.length) return null;
  const sum = was.reduce((s, id) => s + (prev.load.get(id)?.points ?? 0), 0);
  return { mean: sum / was.length, n: was.length };
}
