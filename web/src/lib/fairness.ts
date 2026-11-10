import type { SoldierLoad } from "./draft";

/**
 * Is the draft fair? Each soldier is compared with the soldiers of his group who can do the same
 * duties (the same open duty categories) – that is the mean he is measured against. He stands out
 * when he is further from it than a share of it (the tolerance, % of the mean; at least half a
 * point, so a mean near zero does not flag everyone). Soldiers open to no duty are not compared.
 */

export interface FairRow extends SoldierLoad {
  profile: string; // the open duty categories, "A + B", or "" when none
  ref: number; // the mean of his profile in his group
  diff: number; // expected − ref
  limit: number; // the allowed distance
  outlier: boolean;
  compared: boolean;
}

export interface GroupVerdict {
  pool: string;
  soldiers: number;
  compared: number;
  outliers: FairRow[]; // furthest first
  mean: number;
  min: number;
  max: number;
}

export const MIN_LIMIT = 0.5;

export function fairRows(ls: SoldierLoad[], profileOf: (soldierId: string) => string, tolerancePct: number): FairRow[] {
  const sums = new Map<string, [number, number]>();
  const key = (l: SoldierLoad) => `${l.pool}|${profileOf(l.soldier_id)}`;
  for (const l of ls) {
    if (!profileOf(l.soldier_id)) continue;
    const [s, n] = sums.get(key(l)) ?? [0, 0];
    sums.set(key(l), [s + l.expected, n + 1]);
  }
  return ls.map((l) => {
    const profile = profileOf(l.soldier_id);
    const [s, n] = sums.get(key(l)) ?? [0, 0];
    const ref = n ? s / n : 0;
    const limit = Math.max((Math.abs(ref) * tolerancePct) / 100, MIN_LIMIT);
    const diff = l.expected - ref;
    const compared = !!profile && n > 1;
    return { ...l, profile, ref, diff, limit, compared, outlier: compared && Math.abs(diff) > limit + 1e-9 };
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
  const cats = rest.join(" · ").split(" + ").filter((x) => x.trim() && x.trim() !== "ללא תורנות פתוחה");
  if (!rest.length) return full;
  if (cats.length === 0) return `${pop} · ללא תורנות`;
  if (cats.length === 1) return `${pop} · ${cats[0]}`;
  return `${pop} · ${cats.length} קטגוריות`;
}
