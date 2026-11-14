/** The engine's draft: assignments per slot, candidates for a manual change, load per soldier. */

export type Role = "performer" | "reserve";

export interface DraftAssignment {
  id: string;
  slot_id: string;
  soldier_id: string;
  role: Role;
  status: string;
  source: "solver" | "manual" | "swap" | "escalation";
  points: number;
  normalized_points: number;
  weekend_units: number;
  explanation: string | null;
  manual_reason: string | null;
}

export interface Conflict {
  slot_id: string;
  task: string;
  role: Role;
  starts_at: string;
  ends_at: string;
}

export interface Candidate {
  soldier_id: string;
  reasons: string[];
  conflicts: Conflict[];
  cycle_points: number;
  cycle_duties: number;
  in_slot: Role | null;
}

export const ROLE_LABEL: Record<Role, string> = { performer: "מבצע", reserve: "עתודה" };

/** Eligible and free first (lowest score first), then free but breaking a rule, then busy. */
export function rankCandidates(cs: Candidate[]): Candidate[] {
  const tier = (c: Candidate) => (c.in_slot ? 3 : c.reasons.length === 0 && c.conflicts.length === 0 ? 0 : c.reasons.length === 0 ? 1 : 2);
  return [...cs].sort((a, b) => tier(a) - tier(b) || a.cycle_points - b.cycle_points || a.cycle_duties - b.cycle_duties);
}

export interface SlotView {
  performers: DraftAssignment[];
  reserves: DraftAssignment[];
  missingPerformers: number;
  missingReserves: number;
}

export function bySlot(
  slots: { id: string; performers_needed: number; reserves_needed: number }[],
  assignments: DraftAssignment[],
): Map<string, SlotView> {
  const out = new Map<string, SlotView>();
  for (const s of slots) out.set(s.id, { performers: [], reserves: [], missingPerformers: 0, missingReserves: 0 });
  for (const a of assignments) {
    const v = out.get(a.slot_id);
    if (!v) continue;
    (a.role === "performer" ? v.performers : v.reserves).push(a);
  }
  for (const s of slots) {
    const v = out.get(s.id)!;
    v.missingPerformers = Math.max(0, s.performers_needed - v.performers.length);
    v.missingReserves = Math.max(0, s.reserves_needed - v.reserves.length);
  }
  return out;
}

export interface SoldierLoad {
  soldier_id: string;
  pool: string;
  baseline: number;
  credit: number; // availability credit for days out of the unit not by choice
  creditDays: number;
  points: number; // this cycle, normalized, as performer
  expected: number; // baseline + credit + points
  duties: number;
  reserves: number;
  weekends: number;
  manual: number;
}

export function loads(
  snapshot: {
    soldier_id: string;
    balance_population: string;
    baseline_score: number;
    fairness_group?: string | null;
    credit?: number;
    credit_days?: number;
  }[],
  assignments: DraftAssignment[],
): SoldierLoad[] {
  const m = new Map<string, SoldierLoad>(
    snapshot.map((s) => [
      s.soldier_id,
      {
        soldier_id: s.soldier_id,
        pool: s.fairness_group || s.balance_population,
        baseline: s.baseline_score,
        credit: s.credit ?? 0,
        creditDays: s.credit_days ?? 0,
        points: 0,
        expected: s.baseline_score + (s.credit ?? 0),
        duties: 0,
        reserves: 0,
        weekends: 0,
        manual: 0,
      },
    ]),
  );
  for (const a of assignments) {
    const l = m.get(a.soldier_id);
    if (!l) continue;
    if (a.role === "performer") {
      l.points += a.normalized_points;
      l.duties++;
      l.weekends += a.weekend_units;
    } else l.reserves++;
    if (a.source === "manual") l.manual++;
  }
  for (const l of m.values()) {
    l.points = Math.round(l.points * 100) / 100;
    l.expected = Math.round((l.baseline + l.credit + l.points) * 100) / 100;
  }
  return [...m.values()];
}

export function poolMeans(ls: SoldierLoad[]): Map<string, number> {
  const sums = new Map<string, [number, number]>();
  for (const l of ls) {
    const [s, n] = sums.get(l.pool) ?? [0, 0];
    sums.set(l.pool, [s + l.expected, n + 1]);
  }
  return new Map([...sums].map(([k, [s, n]]) => [k, n ? s / n : 0]));
}

/** The weeks (Sunday start) of a date range, for the filter. */
export function weeksOf(from: string, to: string): string[] {
  const d = new Date(from + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  const out: string[] = [];
  while (d.toISOString().slice(0, 10) <= to) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

export interface ProfileStats {
  key: string; // the open categories, joined
  soldiers: number;
  mean: number;
  min: number;
  max: number;
}

/**
 * Soldiers grouped by what they can do (their open categories): fairness is only meaningful
 * between soldiers who can do the same duties.
 */
export function byProfile(ls: SoldierLoad[], openOf: (soldierId: string) => string[]): ProfileStats[] {
  const groups = new Map<string, number[]>();
  for (const l of ls) {
    const key = openOf(l.soldier_id).sort((a, b) => a.localeCompare(b, "he")).join(" + ") || "—";
    groups.set(key, [...(groups.get(key) ?? []), l.expected]);
  }
  return [...groups]
    .map(([key, v]) => ({
      key,
      soldiers: v.length,
      mean: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10,
      min: Math.min(...v),
      max: Math.max(...v),
    }))
    .sort((a, b) => b.soldiers - a.soldiers);
}

/**
 * Why a soldier has few duties: over the cycle's slots, what kept him out – each ineligibility
 * reason with its number of slots, "busy" (another duty then), "assigned" (he is in it), and
 * "free" (eligible and free: the engine chose others for balance).
 */
export interface WhyItem {
  slot_id: string;
  /** for "busy": the duty he is already on at that time (or resting after) */
  conflict?: Conflict;
}

/** Per reason: how many slots it blocked, and which (slot ids parallel to perSlot when given). */
export function summarizeReasons(perSlot: (Candidate | undefined)[], ids: string[] = []): { reason: string; slots: number; items: WhyItem[] }[] {
  const n = new Map<string, WhyItem[]>();
  const add = (r: string, item: WhyItem) => n.set(r, [...(n.get(r) ?? []), item]);
  perSlot.forEach((c, i) => {
    if (!c) return;
    const slot_id = ids[i] ?? "";
    if (c.in_slot) add("assigned", { slot_id });
    else if (c.reasons.length) c.reasons.forEach((r) => add(r, { slot_id }));
    else if (c.conflicts.length) add("busy", { slot_id, conflict: c.conflicts[0] });
    else add("free", { slot_id });
  });
  return [...n].map(([reason, items]) => ({ reason, slots: items.length, items })).sort((a, b) => b.slots - a.slots);
}
