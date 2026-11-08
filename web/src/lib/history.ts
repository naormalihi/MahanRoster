/**
 * History import (half a year before going live): one row = one duty a soldier did.
 * The personal number becomes the soldier key in the browser, as in the HR load.
 */
import type { TaskType } from "./catalog";
import { cleanName, norm, resolveDuty, slotTimes, weekendVariant, type Alias } from "./baseSchedule";
import { normalizePersonalNumber } from "./hmac";
import { toIsoDate } from "./roster";

export const HISTORY_HEADERS = ["מספר אישי", "תאריך", "תאריך סיום", "תורנות", "עתודה שהוקפצה", "קנס"];

type Field = "pn" | "start" | "end" | "duty" | "reserve" | "penalty";
const SYNONYMS: Record<Field, string[]> = {
  pn: ["מספראישי", "מ.א", "מא", "מספרא"],
  start: ["תאריך", "תאריךהתחלה", "מתאריך"],
  end: ["תאריךסיום", "עדתאריך"],
  duty: ["תורנות", "סוגתורנות", "משימה", "סוגמשימה"],
  reserve: ["עתודהשהוקפצה", "עתודה", "הוקפץ", "הוקפצה"],
  penalty: ["קנס"],
};

export interface HistoryRow {
  line: number;
  personalNumber: string;
  start: string;
  end: string;
  duty: string;
  reserveActivated: boolean;
  penalty: boolean;
}

export interface LineError {
  line: number;
  message: string;
}

const yes = (v: unknown) => /^(כן|v|x|✓|1|true|yes)$/i.test(String(v ?? "").trim());

export function readHistory(rows: unknown[][]): { rows: HistoryRow[]; errors: LineError[]; header: boolean } {
  let headerRow = -1;
  const col: Partial<Record<Field, number>> = {};
  for (let r = 0; r < Math.min(rows.length, 10) && headerRow < 0; r++) {
    const cells = (rows[r] ?? []).map((c) => norm(c).replace(/"/g, ""));
    const found: Partial<Record<Field, number>> = {};
    (Object.keys(SYNONYMS) as Field[]).forEach((f) => {
      // exact first ("תאריך" must not take "תאריך סיום")
      const i = cells.findIndex((c) => SYNONYMS[f].includes(c));
      if (i >= 0) found[f] = i;
    });
    if (found.pn !== undefined && found.start !== undefined && found.duty !== undefined) {
      headerRow = r;
      Object.assign(col, found);
    }
  }
  if (headerRow < 0) return { rows: [], errors: [], header: false };
  const get = (r: unknown[], f: Field) => (col[f] === undefined ? "" : r[col[f]!]);
  const out: HistoryRow[] = [];
  const errors: LineError[] = [];
  rows.slice(headerRow + 1).forEach((r, i) => {
    const line = headerRow + i + 2;
    const rawPn = get(r, "pn");
    const duty = cleanName(get(r, "duty"));
    if (String(rawPn ?? "").trim() === "" && !duty) return;
    const pn = normalizePersonalNumber(rawPn);
    const start = toIsoDate(get(r, "start"));
    const end = String(get(r, "end") ?? "").trim() === "" ? start : toIsoDate(get(r, "end"));
    if (!pn) return void errors.push({ line, message: "מספר אישי לא תקין" });
    if (!duty) return void errors.push({ line, message: "חסרה תורנות" });
    if (!start || start === "invalid") return void errors.push({ line, message: "תאריך לא תקין" });
    if (!end || end === "invalid" || end < start) return void errors.push({ line, message: "תאריך סיום לא תקין" });
    out.push({ line, personalNumber: pn, start, end, duty, reserveActivated: yes(get(r, "reserve")), penalty: yes(get(r, "penalty")) });
  });
  return { rows: out, errors, header: true };
}

export interface HistoryDraft {
  line: number;
  soldier_id: string;
  task_type_id: string;
  starts_at: string;
  ends_at: string;
  reserve_activated: boolean;
  is_penalty: boolean;
}

/**
 * Soldier by key, duty by name or alias (with the weekday/Shabbat sibling by the day),
 * hours from the duty's weekday hours.
 */
export function resolveHistory(
  rows: (HistoryRow & { key: string })[],
  ctx: { soldierByKey: Map<string, string>; tasks: TaskType[]; aliases: Alias[]; weekendIsoDays: number[]; holidays: Set<string> },
): { drafts: HistoryDraft[]; errors: LineError[]; unknownDuties: string[] } {
  const drafts: HistoryDraft[] = [];
  const errors: LineError[] = [];
  const unknown = new Set<string>();
  for (const r of rows) {
    const soldier = ctx.soldierByKey.get(r.key);
    const base = resolveDuty(r.duty, ctx.aliases, ctx.tasks);
    if (!soldier) {
      errors.push({ line: r.line, message: "המספר האישי לא נמצא בכוח האדם (או שמפתח היחידה שונה)" });
      continue;
    }
    if (!base) {
      unknown.add(r.duty);
      errors.push({ line: r.line, message: `תורנות לא מוכרת: ${r.duty}` });
      continue;
    }
    const taskId = weekendVariant(base, r.start, ctx.tasks, ctx.weekendIsoDays);
    const task = ctx.tasks.find((t) => t.id === taskId)!;
    const { starts_at, ends_at } = slotTimes(r.start, r.end, task, ctx.holidays);
    drafts.push({ line: r.line, soldier_id: soldier, task_type_id: taskId, starts_at, ends_at, reserve_activated: r.reserveActivated, is_penalty: r.penalty });
  }
  return { drafts, errors, unknownDuties: [...unknown].sort() };
}

export interface HistoryImport {
  id: string;
  file_name: string;
  rows: number;
  created_at: string;
  approved_at: string | null;
}

export interface HistoryDuty {
  soldier_id: string;
  task_type_id: string;
  starts_at: string;
  normalized_points: number;
  weekend_units: number;
  reserve_activated: boolean;
  is_penalty: boolean;
}

export interface HistorySummary {
  soldier_id: string;
  duties: number;
  points: number;
  weekends: number;
  penalties: number;
}

export function summarizeHistory(duties: HistoryDuty[]): HistorySummary[] {
  const m = new Map<string, HistorySummary>();
  for (const d of duties) {
    const s = m.get(d.soldier_id) ?? { soldier_id: d.soldier_id, duties: 0, points: 0, weekends: 0, penalties: 0 };
    s.duties++;
    s.points = Math.round((s.points + Number(d.normalized_points)) * 100) / 100;
    s.weekends += d.weekend_units;
    if (d.is_penalty) s.penalties++;
    m.set(d.soldier_id, s);
  }
  return [...m.values()].sort((a, b) => b.points - a.points);
}
