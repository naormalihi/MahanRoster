/** Helpers for the published board. */
import type { BoardRow } from "./api";
import { dayKey, timeLabel, TZ } from "./dates";
import { gafFromFramework } from "./roster";

/** "גף ענן" also from an old full framework path. */
export const shortGaf = (name: string) => (name.includes("/") ? gafFromFramework(name) ?? name : name);

export interface Person {
  name: string;
  gaf: string;
}

/** Names with their gaf (the gafim come in the same order as the names). */
export function people(names: string[], gafim?: string[]): Person[] {
  return names.map((name, i) => ({ name, gaf: shortGaf(gafim?.[i] ?? "") }));
}

const weekdayShort = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, weekday: "short" });
const dm = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, day: "numeric", month: "numeric" });

export interface Span {
  from: string; // "08:00"
  to: string; // "08:00"
  /** When the duty ends on another day: "למחרת" or "יום ד׳ 13.1". */
  until: string | null;
}

export function span(startIso: string, endIso: string): Span {
  const days = Math.round((Date.parse(dayKey(endIso)) - Date.parse(dayKey(startIso))) / 86_400_000);
  const end = new Date(endIso);
  return {
    from: timeLabel(startIso),
    to: timeLabel(endIso),
    until: days === 0 ? null : days === 1 ? "למחרת" : `${weekdayShort.format(end)} ${dm.format(end)}`,
  };
}

/** Friday or Saturday in Israel. */
export const isWeekend = (day: string) => {
  const d = new Date(day + "T12:00:00Z").getUTCDay();
  return d === 5 || d === 6;
};

export function groupByDay(rows: BoardRow[]): [string, BoardRow[]][] {
  const m = new Map<string, BoardRow[]>();
  for (const r of [...rows].sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.task_name.localeCompare(b.task_name, "he"))) {
    const k = dayKey(r.starts_at);
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return [...m];
}

/** Does the row involve someone whose name contains q (performer or reserve)? */
export const mentions = (r: BoardRow, q: string) => !q || r.performers.some((n) => n.includes(q)) || r.reserves.some((n) => n.includes(q));

// ---------------------------------------------------------------------------
// Calendar views
// ---------------------------------------------------------------------------

const addDayKey = (day: string, n: number) => {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Weeks (Sunday first) covering a month, as day keys; days outside the month are included. */
export function monthGrid(year: number, month: number): string[][] {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const start = addDayKey(first, -new Date(first + "T12:00:00Z").getUTCDay());
  const weeks: string[][] = [];
  let d = start;
  do {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDayKey(d, i)));
    d = addDayKey(d, 7);
  } while (d.slice(0, 7) <= first.slice(0, 7));
  return weeks;
}

export const weekDays = (sunday: string) => Array.from({ length: 7 }, (_, i) => addDayKey(sunday, i));

export interface DaySummary {
  types: { name: string; color: string | null; count: number }[];
  total: number;
  unstaffed: number;
}

/** Per day: how many duties of each type, and how many have no performer. */
export function daySummaries(rows: BoardRow[]): Map<string, DaySummary> {
  const out = new Map<string, DaySummary>();
  for (const [day, rs] of groupByDay(rows)) {
    const types = new Map<string, { name: string; color: string | null; count: number }>();
    for (const r of rs) {
      const t = types.get(r.task_name) ?? { name: r.task_name, color: r.color, count: 0 };
      t.count++;
      types.set(r.task_name, t);
    }
    out.set(day, { types: [...types.values()], total: rs.length, unstaffed: rs.filter((r) => !r.performers.length).length });
  }
  return out;
}

/** Duty type × day for one week: the rows of the printable week table. */
export function weekMatrix(rows: BoardRow[], days: string[]): { task: string; color: string | null; byDay: Map<string, BoardRow[]> }[] {
  const tasks = new Map<string, { task: string; color: string | null; byDay: Map<string, BoardRow[]> }>();
  for (const r of [...rows].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    const day = dayKey(r.starts_at);
    if (!days.includes(day)) continue;
    const t = tasks.get(r.task_name) ?? { task: r.task_name, color: r.color, byDay: new Map() };
    t.byDay.set(day, [...(t.byDay.get(day) ?? []), r]);
    tasks.set(r.task_name, t);
  }
  return [...tasks.values()].sort((a, b) => a.task.localeCompare(b.task, "he"));
}

// ---------------------------------------------------------------------------
// "My duties" as a calendar file (iCalendar)
// ---------------------------------------------------------------------------

/** Exact names in the rows that contain the search text – to pick one person. */
export function matchingNames(rows: BoardRow[], q: string): string[] {
  if (!q.trim()) return [];
  return [...new Set(rows.flatMap((r) => [...r.performers, ...r.reserves]).filter((n) => n.includes(q.trim())))].sort((a, b) =>
    a.localeCompare(b, "he"),
  );
}

const icsTime = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines longer than 75 octets are folded, as the format requires. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = ch;
    } else cur += ch;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

/** A calendar file with the duties of one person, with a reminder the evening before. */
export function dutiesIcs(rows: BoardRow[], name: string, now = new Date()): { ics: string; count: number } {
  const mine = rows.filter((r) => r.performers.includes(name) || r.reserves.includes(name));
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MahanRoster//HE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsText(`תורנויות – ${name}`)}`];
  for (const r of mine) {
    const reserve = !r.performers.includes(name);
    const details = [
      reserve ? "תפקיד: עתודה" : "תפקיד: מבצע",
      r.report_at ? `התייצבות: ${timeLabel(r.report_at)}${r.report_place ? `, ${r.report_place}` : ""}` : "",
      r.briefing_at ? `תדריך: ${dayKey(r.briefing_at)} ${timeLabel(r.briefing_at)}${r.briefing_place ? `, ${r.briefing_place}` : ""}` : "",
      r.instructions ?? "",
    ].filter(Boolean);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${r.slot_id}-${reserve ? "r" : "p"}@mahanroster`,
      `DTSTAMP:${icsTime(now.toISOString())}`,
      `DTSTART:${icsTime(r.starts_at)}`,
      `DTEND:${icsTime(r.ends_at)}`,
      `SUMMARY:${icsText(`${reserve ? "עתודה – " : ""}${r.task_name}`)}`,
      `DESCRIPTION:${icsText(details.join("\n"))}`,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsText(`מחר: ${r.task_name}`)}`,
      "TRIGGER:-PT12H",
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return { ics: lines.map(fold).join("\r\n") + "\r\n", count: mine.length };
}
