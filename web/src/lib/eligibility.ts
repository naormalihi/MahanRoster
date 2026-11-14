/**
 * What a soldier can be given in a cycle – the first answer to "why so few duties?".
 *
 * Per duty category (from the potential matrix): open or not and why, and how many slots of
 * that category the cycle has. A soldier with nothing open, or open only where the cycle has
 * no slots, cannot get any duty however the engine balances – that is a catalog or base-file
 * question, not a fairness one.
 */
import { effective, reasonText, type PotentialCell } from "./potential";
import type { SlotRow } from "./baseSchedule";
import type { TaskType } from "./catalog";

export interface EligRow {
  category_id: string;
  name: string;
  open: boolean;
  /** share of the cycle he is available for it (1 = all of it) */
  value: number;
  slots: number;
  reasons: string[];
  override: boolean;
}

/** Slots per duty category in the cycle. */
export function slotsByCategory(slots: Pick<SlotRow, "task_type_id">[], tasks: Map<string, Pick<TaskType, "category_id">>): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of slots) {
    const c = tasks.get(s.task_type_id)?.category_id;
    if (c) m.set(c, (m.get(c) ?? 0) + 1);
  }
  return m;
}

export function eligibilityOf(
  soldierId: string,
  cells: PotentialCell[],
  categories: Map<string, string>,
  slotsPerCategory: Map<string, number>,
): EligRow[] {
  return cells
    .filter((c) => c.soldier_id === soldierId)
    .map((c) => ({
      category_id: c.category_id,
      name: categories.get(c.category_id) ?? "?",
      open: effective(c) > 0,
      value: effective(c),
      slots: slotsPerCategory.get(c.category_id) ?? 0,
      reasons: c.reasons,
      override: c.override_value !== null,
    }))
    .sort((a, b) => Number(b.open) - Number(a.open) || b.slots - a.slots || a.name.localeCompare(b.name, "he"));
}

/** Why he cannot get any duty in the cycle, or null when he can. */
export type NoWork = "none_open" | "no_slots";

export function noWork(rows: EligRow[]): NoWork | null {
  if (!rows.length) return null; // no potential computed – nothing to say
  const open = rows.filter((r) => r.open);
  if (!open.length) return "none_open";
  return open.some((r) => r.slots > 0) ? null : "no_slots";
}

/** The reasons that close most categories for him, most common first. */
export function mainReasons(rows: EligRow[]): string[] {
  const n = new Map<string, number>();
  for (const r of rows) if (!r.open) for (const x of r.reasons) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r);
}

/** One line: why there is no duty for him in this cycle. */
export function noWorkText(rows: EligRow[], rankName: string): string | null {
  const w = noWork(rows);
  if (w === "no_slots") {
    const open = rows.filter((r) => r.open).map((r) => r.name);
    return `כשיר רק ל${open.join(", ")}, ובמחזור אין משבצות כאלה.`;
  }
  if (w === "none_open") {
    // the rank is the cause only when it closes every category; otherwise say what closes the
    // ones his rank fits (e.g. not available all cycle)
    const rankFits = rows.filter((r) => !r.reasons.includes("rank"));
    if (!rankFits.length) return `לא כשיר לאף קטגוריית תורנות: הדרגה ${rankName} לא ברשימת הדרגות של אף סוג תורנות.`;
    const why = reasonText(mainReasons(rankFits).slice(0, 2));
    return `לא כשיר לאף קטגוריית תורנות: הדרגה ${rankName} מתאימה רק ל${rankFits.map((r) => r.name).join(", ")}, ושם – ${why}.`;
  }
  return null;
}

/**
 * Soldiers with no possible duty, gathered by cause, for the soldiers view.
 * Key = what to fix: the open categories that have no slots, or the rank that fits none.
 */
export function noWorkGroups(
  ids: string[],
  rowsOf: (id: string) => EligRow[],
  rankOf: (id: string) => string,
): { key: string; label: string; ids: string[] }[] {
  const groups = new Map<string, { label: string; ids: string[] }>();
  for (const id of ids) {
    const rows = rowsOf(id);
    const w = noWork(rows);
    if (!w) continue;
    let key: string, label: string;
    if (w === "no_slots") {
      const open = rows.filter((r) => r.open).map((r) => r.name).sort((a, b) => a.localeCompare(b, "he"));
      key = `slots:${open.join("+")}`;
      label = `כשירים רק ל${open.join(", ")} – אין משבצות במחזור`;
    } else {
      const rankFits = rows.filter((r) => !r.reasons.includes("rank"));
      const main = mainReasons(rankFits);
      if (!rankFits.length) {
        key = `rank:${rankOf(id)}`;
        label = `דרגת ${rankOf(id)} – לא ברשימת הדרגות של אף סוג`;
      } else {
        key = `why:${main.slice(0, 2).join("+")}`;
        label = `לא כשירים לאף קטגוריה: ${reasonText(main.slice(0, 2)) || "פטור או לא זמינים"}`;
      }
    }
    const g = groups.get(key) ?? { label, ids: [] };
    g.ids.push(id);
    groups.set(key, g);
  }
  return [...groups.entries()].map(([key, g]) => ({ key, ...g })).sort((a, b) => b.ids.length - a.ids.length);
}
