/**
 * Base schedule file (לוח המשימות): one row = one slot, one performer + one reserve.
 * Only two columns are read: the date (מועד) and the duty type (סוג משימה). Everything else is
 * derived: the hours from the duty type (by weekday), the Shabbat variant and the holidays from
 * the date, who may do it from the duty type. Any other column in the file is ignored.
 */

import type { TaskType } from "./catalog";
import { addDaysIso, isoDate } from "./cycles";
import { TZ } from "./dates";
import { toIsoDate } from "./roster";

export type BaseField = "start" | "duty" | "note";

const SYNONYMS: Record<BaseField, string[]> = {
  start: ["מועד", "תאריך", "תאריךהתחלה", "מתאריך", "התחלה"],
  duty: ["סוגתורנות", "תורנות", "משימה", "סוגמשימה"],  // file headers people already have
  // optional. Not "הערות": in the base's own file that column holds contacts and phones, and the note is public
  note: ["הערה", "דגשים", "הערהלמשימה"],
};

/** A note shown on the duty – on the board, in "המשימות שלי", in messages. */
export const NOTE_MAX = 300;

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
  /** military names read from files ("סמל", "רס"ן") */
  aliases?: string[];
}

export interface ParsedRanks {
  /** null = no restriction from the file (the duty's own range applies) */
  rankIds: string[] | null;
  unknown: string[];
  /** "ת"ש 7": the slot is meant first for soldiers who must be home nightly */
  homeNightly: boolean;
}

export function parseRanks(text: unknown, ranks: RankRef[]): ParsedRanks {
  const raw = cleanName(text);
  const tash = /ת"?ש7/;
  const homeNightly = tash.test(norm(raw));
  if (!raw || norm(raw).includes("כללהדרגות")) return { rankIds: null, unknown: [], homeNightly };
  const military = ranks.filter((r) => r.sort_order < 50);
  const byName = new Map(military.flatMap((r) => [r.name, ...(r.aliases ?? [])].map((n) => [norm(n).replace(/"/g, ""), r] as const)));
  const find = (t: string) => byName.get(norm(t).replace(/"/g, ""));
  const ids = new Set<string>();
  const unknown: string[] = [];
  for (const part of raw.split(/[,،;\n]+/).map((p) => p.trim()).filter(Boolean)) {
    // "סרן במינוי רס"ן" – the appointment rank is what counts, and the snapshot already uses it
    if (tash.test(norm(part))) continue; // not a rank: ת"ש 7 (home every night)
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
  return { rankIds: ids.size ? [...ids] : null, unknown, homeNightly };
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
    if (!duty) return void errors.push({ line, message: "חסר סוג משימה" });
    if (!start || start === "invalid") return void errors.push({ line, message: `${duty}: מועד לא תקין` });
    const note = String(col(r, "note") ?? "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((l) => l.replace(/[ \t]+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
    if (note.length > NOTE_MAX) return void errors.push({ line, message: `${duty}: הערה ארוכה מ-${NOTE_MAX} תווים` });
    // the date, the duty type and a note; the rest comes from the duty type and the calendar
    out.push({ line, duty, start, end: start, population: "", ranksText: "", instructions: note, notes: "", holiday: null });
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
  prefer_home_nightly: boolean;
  /** multi-day slot of a within-the-day duty: worked these hours each day */
  daily_hours: string | null;
  weekendSwitched: boolean;
  /** The file and the holiday calendar disagree on whether the duty falls on a holiday. */
  holidayMismatch: "file_only" | "calendar_only" | null;
  briefing_at: string | null;
  /** a briefing day was written but is too far before the start to be about this slot */
  briefingIgnored: boolean;
  /** the population column contradicts the mapped type (e.g. "חובה" on a career-only type) */
  populationMismatch: boolean;
}

const dowOf = (day: string) => new Date(day + "T12:00:00Z").getUTCDay(); // 0 = Sunday

/**
 * The hours a duty type uses on a given start day: by weekday (or after a holiday) when set, else the
 * defaults. A window ending "+1" ends the next day ("06:00-08:00+1"); so does one whose end is not after its start.
 */
export function hoursOn(
  day: string,
  task: Pick<TaskType, "default_start_time" | "default_end_time" | "weekday_hours">,
  holidays?: Set<string>,
): [string, string, boolean] {
  const wh = task.weekday_hours;
  const w = wh && ((holidays?.has(addDaysIso(day, -1)) && wh.after_holiday) || wh[String(dowOf(day))]);
  const [a, b] = w ? w.split("-") : [task.default_start_time ?? "08:00", task.default_end_time ?? "08:00"];
  const end = b.replace("+1", "");
  return [a, end, b.endsWith("+1") || end <= a];
}

/**
 * Times: the duty type's hours on the start and end dates. One day: ends the next day when the
 * window says so (08:00 → 08:00). Several days: ends on the end date.
 */
export function slotTimes(
  start: string,
  end: string,
  task: Pick<TaskType, "default_start_time" | "default_end_time"> & Partial<Pick<TaskType, "weekday_hours">>,
  holidays?: Set<string>,
) {
  const t = { weekday_hours: null, ...task };
  const [st, , nextDay] = hoursOn(start, t, holidays);
  const [, et] = hoursOn(end, t, holidays);
  const endDay = end > start || !nextDay ? end : addDaysIso(end, 1);
  return { starts_at: localTs(start, st), ends_at: localTs(endDay, et) };
}

const WEEKDAY_WORD: Record<string, number> = { ראשון: 0, שני: 1, שלישי: 2, רביעי: 3, חמישי: 4, שישי: 5, שבת: 6 };

/**
 * A briefing written in the instructions ("התייצבות לתדריך ביום שלישי ... בשעה 13:00"): the last such
 * weekday on or before the start, up to 3 days before. A phone briefing does not count.
 */
export function parseBriefing(instructions: string | null, startDay: string): { at: string | null; ignored: boolean } {
  const line = (instructions ?? "").split(/\n/).find((l) => l.includes("תדריך") && !l.includes("טלפוני"));
  if (!line) return { at: null, ignored: false };
  const dayWord = line.match(/ביום\s+(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)/);
  const time = line.match(/(\d{1,2}):(\d{2})/);
  if (!dayWord || !time) return { at: null, ignored: false };
  const want = WEEKDAY_WORD[dayWord[1]];
  const back = (dowOf(startDay) - want + 7) % 7;
  if (back > 3) return { at: null, ignored: true };
  return { at: localTs(addDaysIso(startDay, -back), `${time[1].padStart(2, "0")}:${time[2]}`), ignored: false };
}

/** The file's population column against the mapped type's service restriction. */
export function populationMismatch(population: string, task: Pick<TaskType, "service_restriction">): boolean {
  const p = norm(population);
  if (p === "חובה") return task.service_restriction === "career";
  if (p === norm("קצינים ונגדים")) return task.service_restriction === "mandatory";
  return false;
}

/** A duty type that runs within one day (08:00–17:00), over several days, is worked those hours each day. */
export function dailyHours(start: string, end: string, task: Pick<TaskType, "default_start_time" | "default_end_time">): string | null {
  const st = task.default_start_time, et = task.default_end_time;
  return end > start && st && et && et > st ? `${st}-${et}` : null;
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
    // the note is shown as written: no briefing time or gender is read out of it
    const briefing = { at: null, ignored: false };
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
      ...slotTimes(r.start, r.end, task, ctx.holidays),
      performers_needed: 1,
      reserves_needed: 1,
      allowed_rank_ids: ranks.rankIds,
      gender: null,
      instructions: r.instructions || null,
      notes: r.notes || null,
      ranksText: r.ranksText,
      unknownRanks: ranks.unknown,
      prefer_home_nightly: ranks.homeNightly,
      daily_hours: dailyHours(r.start, r.end, task),
      weekendSwitched: taskId !== mapped,
      holidayMismatch,
      briefing_at: briefing.at,
      briefingIgnored: briefing.ignored,
      populationMismatch: populationMismatch(r.population, task),
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
  prefer_home_nightly: boolean;
  daily_hours: string | null;
  briefing_at: string | null;
  /** added after publishing and caught its performer by surprise (הקפצה) */
  is_surprise?: boolean;
  /** a special call-up (הקפצה מיוחדת): its own name and its points for the whole duty */
  special_name?: string | null;
  fixed_points?: number | null;
  assigned: number; // assignments that are not drafts
}

/** A duty added by hand (e.g. after publishing). */
export interface NewSlot {
  task_type_id: string;
  starts_at: string; // ISO
  ends_at: string;
  performers_needed: number;
  reserves_needed: number;
  is_surprise: boolean;
  special_name?: string;
  fixed_points?: number;
  allowed_rank_ids?: string[] | null;
  /** the note shown on the duty */
  instructions?: string | null;
}

/** Template for a base file, for manual preparation or testing. */
export const BASE_TEMPLATE_HEADERS = ["מועד", "סוג משימה", "הערה"];

export const dayOf = (isoTs: string) => {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(new Date(isoTs));
};

export { isoDate };

/** A duty's name as people see it: a special call-up's own name, else its type's. */
export function slotName(k: { special_name?: string | null; task_type_id: string }, taskName: (id: string) => string | undefined): string {
  return k.special_name || taskName(k.task_type_id) || "משימה";
}
