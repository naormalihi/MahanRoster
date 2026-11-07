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
