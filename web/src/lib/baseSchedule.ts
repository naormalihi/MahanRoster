/**
 * Base schedule file (לוח הבסיס): one row = one slot, one performer + one reserve.
 * The performer / reserve / gaf columns are ignored (they come from the base's systems,
 * not an allocation); colours are not read; holidays come from the Hebrew calendar.
 */

import type { TaskType } from "./catalog";
import { addDaysIso, isoDate } from "./cycles";
import { TZ } from "./dates";
import { toIsoDate } from "./roster";

export type BaseField = "population" | "start" | "end" | "duty" | "ranks" | "instructions" | "notes" | "holiday";

const SYNONYMS: Record<BaseField, string[]> = {
  population: ["אוכלוסיה", "אוכלוסייה"],
  start: ["תאריךהתחלה", "מתאריך", "התחלה"],
  end: ["תאריךסיום", "עדתאריך", "סיום"],
  duty: ["תורנות", "משימה", "סוגמשימה", "סוגתורנות"],
  ranks: ["דרגות", "דרגה", "טווחדרגות"],
  instructions: ["הנחיות"],
  notes: ["הערות"],
  holiday: ["חג"],
};

/** Quotes and gershayim unified, spaces dropped – for matching names. */
export const norm = (s: unknown) =>
  String(s ?? "")
    .replace(/[״”“'׳`]/g, '"')
    .replace(/\s+/g, "")
    .trim();

/** For display and as the alias key: trimmed, single spaces, unified quotes. */
export const cleanName = (s: unknown) =>
  String(s ?? "")
    .replace(/[״”“]/g, '"')
    .replace(/\s+/g, " ")
    .trim();

/** Finds the header row (the first with both a duty and a start-date column) and maps the columns. */
export function findHeader(rows: unknown[][]): { headerRow: number; columns: Partial<Record<BaseField, number>> } | null {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cells = (rows[r] ?? []).map(norm);
    const columns: Partial<Record<BaseField, number>> = {};
    (Object.keys(SYNONYMS) as BaseField[]).forEach((f) => {
      const i = cells.findIndex((c) => SYNONYMS[f].some((syn) => c === syn || c.replace(/"/g, "") === syn));
      if (i >= 0) columns[f] = i;
    });
    if (columns.duty !== undefined && columns.start !== undefined) return { headerRow: r, columns };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ranks: "כלל הדרגות" / "רס"ן" / "סמל - רס"ל, סג"מ - סגן, קמ"א" / "רס"ן, סרן במינוי רס"ן"
// ---------------------------------------------------------------------------

export interface RankRef {
  id: string;
  name: string;
  sort_order: number;
}

export interface ParsedRanks {
  /** null = no restriction from the file (the duty's own range applies) */
  rankIds: string[] | null;
  unknown: string[];
}

export function parseRanks(text: unknown, ranks: RankRef[]): ParsedRanks {
  const raw = cleanName(text);
  if (!raw || norm(raw).includes("כללהדרגות")) return { rankIds: null, unknown: [] };
  const military = ranks.filter((r) => r.sort_order < 50);
  const byName = new Map(military.map((r) => [norm(r.name).replace(/"/g, ""), r]));
  const find = (t: string) => byName.get(norm(t).replace(/"/g, ""));
  const ids = new Set<string>();
  const unknown: string[] = [];
  for (const part of raw.split(/[,،;\n]+/).map((p) => p.trim()).filter(Boolean)) {
    // "סרן במינוי רס"ן" – the appointment rank is what counts, and the snapshot already uses it
    const appointed = part.match(/^(.+?)\s+במינוי\s+(.+)$/);
    const token = appointed ? appointed[2] : part;
    const range = token.split(/\s*[-–]\s*/).filter(Boolean);
    if (range.length === 2) {
      const a = find(range[0]), b = find(range[1]);
      if (!a || !b) {
        unknown.push(part);
        continue;
      }
      const [lo, hi] = [Math.min(a.sort_order, b.sort_order), Math.max(a.sort_order, b.sort_order)];
      military.filter((r) => r.sort_order >= lo && r.sort_order <= hi).forEach((r) => ids.add(r.id));
    } else {
      const r = find(token);
      if (r) ids.add(r.id);
      else unknown.push(part);
    }
  }
  return { rankIds: ids.size ? [...ids] : null, unknown };
}

export function genderHint(text: unknown): "male" | "female" | null {
  const t = norm(text);
  if (t.includes("בניםבלבד")) return "male";
  if (t.includes("בנותבלבד")) return "female";
  return null;
}

// ---------------------------------------------------------------------------
// Duty names → duty types
// ---------------------------------------------------------------------------

export interface Alias {
  alias: string;
  task_type_id: string;
}

/** Name without a "– חול" / "– שבת" suffix, to find the weekday/Shabbat sibling of a duty. */
const baseName = (name: string) => cleanName(name).replace(/\s*[-–]\s*(חול|שבת)$/, "");

export function resolveDuty(name: string, aliases: Alias[], tasks: TaskType[]): string | null {
  const key = norm(name);
  const a = aliases.find((x) => norm(x.alias) === key);
  if (a) return a.task_type_id;
  const t = tasks.find((x) => norm(x.name) === key || norm(baseName(x.name)) === key);
  return t?.id ?? null;
}

/**
 * The base uses one name for the weekday and the Shabbat duty. A slot starting on a weekend
 * day goes to the Shabbat type of the same duty (same category and base name), and back.
 */
export function weekendVariant(taskId: string, startDay: string, tasks: TaskType[], weekendIsoDays: number[]): string {
  const t = tasks.find((x) => x.id === taskId);
  if (!t) return taskId;
  const dow = new Date(startDay + "T12:00:00Z").getUTCDay(); // 0 = Sunday
  const iso = dow === 0 ? 7 : dow;
  const weekend = weekendIsoDays.includes(iso);
  if (weekend === t.is_weekend_type) return taskId;
  const sibling = tasks.find(
    (x) => x.is_active && x.id !== t.id && x.category_id === t.category_id && x.is_weekend_type === weekend && baseName(x.name) === baseName(t.name),
  );
  return sibling?.id ?? taskId;
}

// ---------------------------------------------------------------------------
// Rows → slots
// ---------------------------------------------------------------------------

export interface BaseRow {
  line: number;
  population: string;
  start: string;
  end: string;
  duty: string;
  ranksText: string;
  instructions: string;
  notes: string;
  /** The base's "חג" column: X = not a holiday duty. null when the file has no such column. */
  holiday: boolean | null;
}

export function readRows(rows: unknown[][]): { rows: BaseRow[]; errors: { line: number; message: string }[]; header: boolean } {
  const h = findHeader(rows);
  if (!h) return { rows: [], errors: [], header: false };
  const col = (r: unknown[], f: BaseField) => (h.columns[f] === undefined ? "" : r[h.columns[f]!]);
  const out: BaseRow[] = [];
  const errors: { line: number; message: string }[] = [];
  rows.slice(h.headerRow + 1).forEach((r, i) => {
    const line = h.headerRow + i + 2;
    const duty = cleanName(col(r, "duty"));
    const startRaw = col(r, "start");
    if (!duty && String(startRaw ?? "").trim() === "") return; // empty / spacer row
    const start = toIsoDate(startRaw);
    const end = String(col(r, "end") ?? "").trim() === "" ? start : toIsoDate(col(r, "end"));
    if (!duty) return void errors.push({ line, message: "חסר שם תורנות" });
    if (!start || start === "invalid") return void errors.push({ line, message: `${duty}: תאריך התחלה לא תקין` });
    if (!end || end === "invalid") return void errors.push({ line, message: `${duty}: תאריך סיום לא תקין` });
    if (end < start) return void errors.push({ line, message: `${duty}: תאריך הסיום לפני תאריך ההתחלה` });
    out.push({
      line,
      duty,
      start,
      end,
      population: cleanName(col(r, "population")),
      ranksText: cleanName(col(r, "ranks")),
      instructions: String(col(r, "instructions") ?? "").trim(),
      notes: String(col(r, "notes") ?? "").trim(),
      holiday: h.columns.holiday === undefined ? null : !/^[xX×✗]$/.test(String(col(r, "holiday") ?? "").trim()),
    });
  });
  return { rows: out, errors, header: true };
}

/** Local wall-clock time in the unit's time zone, as an ISO timestamp with offset. */
export function localTs(day: string, hhmm: string): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" })
    .formatToParts(new Date(`${day}T12:00:00Z`))
    .find((p) => p.type === "timeZoneName")!.value;
  return `${day}T${hhmm}:00${part === "GMT" ? "+00:00" : part.slice(3)}`;
}

export interface SlotDraft {
  line: number;
  duty: string; // as in the file
  task_type_id: string;
  starts_at: string;
  ends_at: string;
  performers_needed: number;
  reserves_needed: number;
  allowed_rank_ids: string[] | null;
  gender: "male" | "female" | null;
  instructions: string | null;
  notes: string | null;
  ranksText: string;
  unknownRanks: string[];
  weekendSwitched: boolean;
  /** The file and the holiday calendar disagree on whether the duty falls on a holiday. */
  holidayMismatch: "file_only" | "calendar_only" | null;
}

/**
 * Times: the duty type's default hours on the start and end dates. An end that is not after
 * the start (08:00 → 08:00 on the same date) runs to the next day.
 */
export function slotTimes(start: string, end: string, task: Pick<TaskType, "default_start_time" | "default_end_time">) {
  const st = task.default_start_time ?? "08:00";
  const et = task.default_end_time ?? "08:00";
  const endDay = end > start || et > st ? end : addDaysIso(end, 1);
  return { starts_at: localTs(start, st), ends_at: localTs(endDay, et) };
}

export interface BuildResult {
  slots: SlotDraft[];
  unmapped: { duty: string; count: number; population: string }[];
  outside: BaseRow[];
}

export function buildSlots(
  rows: BaseRow[],
  ctx: {
    aliases: Alias[];
    tasks: TaskType[];
    ranks: RankRef[];
    weekendIsoDays: number[];
    cycle: { start_date: string; end_date: string };
    /** holiday and holiday-eve days from the calendar */
    holidays?: Set<string>;
  },
): BuildResult {
  const unmapped = new Map<string, { duty: string; count: number; population: string }>();
  const slots: SlotDraft[] = [];
  const outside: BaseRow[] = [];
  for (const r of rows) {
    // a slot belongs to the cycle it starts in
    if (r.start < ctx.cycle.start_date || r.start > ctx.cycle.end_date) {
      outside.push(r);
      continue;
    }
    const mapped = resolveDuty(r.duty, ctx.aliases, ctx.tasks);
    if (!mapped) {
      const u = unmapped.get(norm(r.duty)) ?? { duty: r.duty, count: 0, population: r.population };
      u.count++;
      unmapped.set(norm(r.duty), u);
      continue;
    }
    const taskId = weekendVariant(mapped, r.start, ctx.tasks, ctx.weekendIsoDays);
    const task = ctx.tasks.find((t) => t.id === taskId)!;
    const ranks = parseRanks(r.ranksText, ctx.ranks);
    let holidayMismatch: SlotDraft["holidayMismatch"] = null;
    if (r.holiday !== null && ctx.holidays) {
      let onHoliday = false;
      for (let d = r.start; d <= r.end; d = addDaysIso(d, 1)) if (ctx.holidays.has(d)) onHoliday = true;
      if (r.holiday && !onHoliday) holidayMismatch = "file_only";
      if (!r.holiday && onHoliday) holidayMismatch = "calendar_only";
    }
    slots.push({
      line: r.line,
      duty: r.duty,
      task_type_id: taskId,
      ...slotTimes(r.start, r.end, task),
      performers_needed: 1,
      reserves_needed: 1,
      allowed_rank_ids: ranks.rankIds,
      gender: genderHint(r.instructions),
      instructions: r.instructions || null,
      notes: r.notes || null,
      ranksText: r.ranksText,
      unknownRanks: ranks.unknown,
      weekendSwitched: taskId !== mapped,
      holidayMismatch,
    });
  }
  return { slots, unmapped: [...unmapped.values()].sort((a, b) => b.count - a.count), outside };
}

/** A slot as stored, for the list on the base-schedule screen. */
export interface SlotRow {
  id: string;
  task_type_id: string;
  starts_at: string;
  ends_at: string;
  performers_needed: number;
  reserves_needed: number;
  allowed_rank_ids: string[] | null;
  gender: "male" | "female" | null;
  instructions: string | null;
  notes: string | null;
  source_line: number | null;
  assigned: number; // assignments that are not drafts
}

/** Template for a base file, for manual preparation or testing. */
export const BASE_TEMPLATE_HEADERS = ["אוכלוסיה", "תאריך התחלה", "תאריך סיום", "תורנות", "מבצע", "גף", "עתודה", "גף", "דרגות", "הנחיות", "הערות"];

export const dayOf = (isoTs: string) => {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(new Date(isoTs));
};

export { isoDate };
