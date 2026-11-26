import type { SoldierLoad } from "./draft";

/**
 * Is the draft balanced? Each soldier is compared with the soldiers of his group who can do the
 * same duties (the same open duty categories) – that is the mean he is measured against. His score
 * is cumulative (the previous cycles + availability credit + this cycle), so what this cycle tips
 * is weighed against what came before.
 *
 * With one or two duties a cycle, a single duty moves a soldier far from the mean: that is not a
 * problem, it is how the load comes in whole duties, and the next cycle evens it out. So:
 *  - "small": further than the tolerance (% of the mean, at least half a point) but no further
 *    than one duty open to him is worth (the heaviest one of the cycle, day addition included) –
 *    shown quietly, "יתאזן במחזור הבא";
 *  - "outlier" (a cumulative gap, a real problem): further than both.
 * Soldiers open to no duty are not compared – nor one who leaves during the cycle (2.65.1): there is
 * no next cycle to even his gap out, so it is noise; he is left out of his group's mean too.
 */

export interface FairRow extends SoldierLoad {
  profile: string; // the open duty categories, "A + B", or "" when none
  ref: number; // the mean of his profile in his group
  diff: number; // expected − ref
  limit: number; // the allowed distance: the tolerance or one duty, whichever is larger
  /** the tolerance alone (% of the mean) */
  tolLimit: number;
  /** what one duty open to him is worth this cycle (0 when unknown) */
  oneDuty: number;
  outlier: boolean;
  /** beyond the tolerance but within one duty: evens out next cycle */
  small: boolean;
  compared: boolean;
  /** left out of the comparison on purpose, and why ("משתחרר 27.1") */
  excludedWhy: string | null;
}

export interface GroupVerdict {
  pool: string;
  soldiers: number;
  compared: number;
  outliers: FairRow[]; // furthest first
  small: FairRow[]; // within one duty – evens out next cycle
  mean: number;
  min: number;
  max: number;
}

export const MIN_LIMIT = 0.5;

export function fairRows(
  ls: SoldierLoad[],
  profileOf: (soldierId: string) => string,
  tolerancePct: number,
  oneDutyOf: (soldierId: string) => number = () => 0,
  excluded: (soldierId: string) => string | null = () => null,
): FairRow[] {
  const sums = new Map<string, [number, number]>();
  const key = (l: SoldierLoad) => `${l.pool}|${profileOf(l.soldier_id)}`;
  for (const l of ls) {
    if (!profileOf(l.soldier_id) || excluded(l.soldier_id)) continue;
    const [s, n] = sums.get(key(l)) ?? [0, 0];
    sums.set(key(l), [s + l.expected, n + 1]);
  }
  return ls.map((l) => {
    const profile = profileOf(l.soldier_id);
    const [s, n] = sums.get(key(l)) ?? [0, 0];
    const ref = n ? s / n : 0;
    const tolLimit = Math.max((Math.abs(ref) * tolerancePct) / 100, MIN_LIMIT);
    const oneDuty = Math.max(0, oneDutyOf(l.soldier_id) || 0);
    const limit = Math.max(tolLimit, oneDuty);
    const diff = l.expected - ref;
    const excludedWhy = excluded(l.soldier_id);
    const compared = !!profile && n > 1 && !excludedWhy;
    const outlier = compared && Math.abs(diff) > limit + 1e-9;
    const small = compared && !outlier && Math.abs(diff) > tolLimit + 1e-9;
    return { ...l, profile, ref, diff, limit, tolLimit, oneDuty, compared, outlier, small, excludedWhy };
  });
}

export function verdicts(rows: FairRow[]): Map<string, GroupVerdict> {
  const by = new Map<string, FairRow[]>();
  for (const r of rows) by.set(r.pool, [...(by.get(r.pool) ?? []), r]);
  return new Map(
    [...by].map(([pool, rs]) => {
      const v = rs.map((r) => r.expected);
      return [
        pool,
        {
          pool,
          soldiers: rs.length,
          compared: rs.filter((r) => r.compared).length,
          outliers: rs.filter((r) => r.outlier).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)),
          small: rs.filter((r) => r.small),
          mean: v.reduce((a, b) => a + b, 0) / (v.length || 1),
          min: Math.min(...v),
          max: Math.max(...v),
        },
      ];
    }),
  );
}

/** A short group label: population and how many duty categories, e.g. "קבע · 4 קטגוריות". */
export function shortGroupName(full: string): string {
  const [pop, ...rest] = full.split(" · ");
  const cats = rest.join(" · ").split(" + ").filter((x) => x.trim() && !["ללא משימה פתוחה", "ללא תורנות פתוחה"].includes(x.trim()));  // the old wording, in labels kept before 2.50
  if (!rest.length) return full;
  if (cats.length === 0) return `${pop} · ללא משימה`;
  if (cats.length === 1) return `${pop} · ${cats[0]}`;
  return `${pop} · ${cats.length} קטגוריות`;
}

/**
 * What one duty is worth to each soldier this cycle: the most points any duty of a category open to
 * him carries (as given in the draft, day addition and call-up included). A soldier whose categories
 * have no duty given yet gets the most of his group.
 */
export function oneDutyByCategory(
  assignments: { slot_id: string; normalized_points: number; role: string }[],
  categoryOfSlot: (slotId: string) => string | undefined,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of assignments) {
    if (a.role !== "performer") continue;
    const c = categoryOfSlot(a.slot_id);
    if (c) m.set(c, Math.max(m.get(c) ?? 0, a.normalized_points));
  }
  return m;
}

/** A duty given out of turn (public.order_inversions). */
export interface Inversion {
  slot_id: string;
  assignment_id: string;
  task_name: string;
  starts_at: string;
  ends_at: string;
  assigned_id: string;
  assigned_total: number;
  skipped_id: string;
  skipped_total: number;
  points: number;
}
