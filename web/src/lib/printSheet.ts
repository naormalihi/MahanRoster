import type { BoardRow } from "./api";
import { span } from "./board";
import { dayKey } from "./dates";

/**
 * The printed board: one month per A4 landscape page – days down, duty types across.
 * Everything here is plain data so the layout (columns, usual hours, font size, page split)
 * can be tested without a browser.
 */

export interface SheetItem {
  performers: string[];
  reserves: string[];
  /** hours, only when they differ from the column's usual hours */
  time: string | null;
}

export interface SheetColumn {
  task: string;
  color: string | null;
  /** the usual hours of the duty this month, e.g. "08–17" or "יממה 08" */
  time: string;
}

export interface SheetDay {
  day: string; // YYYY-MM-DD
  date: number;
  weekday: number; // 0 = Sunday
  weekend: boolean;
  /** a Sunday that is not the first row: draw the week line above it */
  weekStart: boolean;
  holiday: string | null;
  cells: SheetItem[][]; // by column
  /** the tallest cell, in lines */
  lines: number;
}

export interface SheetPage {
  title: string;
  columns: SheetColumn[];
  days: SheetDay[];
  /** font size in pt, so the page fills one A4 sheet */
  fontPt: number;
  count: number;
  /** the latest change after publishing, if any */
  updated: string | null;
}

/** Usable table height on A4 landscape (mm): 210 − margins − title − column heads − footer. */
export const TABLE_MM = 168;
const MM_PER_PT = 0.3528;
const LINE = 1.12; // line height, in font sizes
const ROW_PAD_MM = 0.9; // cell padding + border per row
export const MAX_PT = 9;
/** below this a page is split in two halves */
export const MIN_PT = 6.2;

const hh = (t: string) => (t.endsWith(":00") ? t.slice(0, 2) : t);

/** "08:00–17:00", "יממה · 08:00", "13:00–09:00 למחרת" – the board's time words. */
export function timeWords(startIso: string, endIso: string): string {
  const t = span(startIso, endIso);
  if (!t.until) return `${t.from}–${t.to}`;
  if (t.until === "למחרת") return t.from === t.to ? `יממה · ${t.from}` : `${t.from}–${t.to} למחרת`;
  return `${t.from} עד ${t.until} ${t.to}`;
}

/** The short form for a column head: "08–17", "יממה 08". */
function shortTime(startIso: string, endIso: string): string {
  const t = span(startIso, endIso);
  if (!t.until) return `${hh(t.from)}–${hh(t.to)}`;
  if (t.until === "למחרת" && t.from === t.to) return `יממה ${hh(t.from)}`;
  return `${hh(t.from)}–${hh(t.to)}${t.until === "למחרת" ? " למחרת" : ""}`;
}

const timeKey = (r: BoardRow) => timeWords(r.starts_at, r.ends_at);

/** Days of a month as YYYY-MM-DD (month is 1-based). */
export function monthDays(year: number, month: number): string[] {
  const n = new Date(year, month, 0).getDate();
  return Array.from({ length: n }, (_, i) => `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`);
}

/** Columns: every duty type of the month, by category then name; usual hours = the most common. */
export function sheetColumns(rows: BoardRow[]): (SheetColumn & { usual: string })[] {
  const by = new Map<string, BoardRow[]>();
  for (const r of rows) by.set(r.task_name, [...(by.get(r.task_name) ?? []), r]);
  const cat = (task: string) => by.get(task)![0].category_name ?? "";
  return [...by.keys()]
    .sort((a, b) => cat(a).localeCompare(cat(b), "he") || a.localeCompare(b, "he"))
    .map((task) => {
      const rs = by.get(task)!;
      const counts = new Map<string, { n: number; r: BoardRow }>();
      for (const r of rs) {
        const k = timeKey(r);
        counts.set(k, { n: (counts.get(k)?.n ?? 0) + 1, r });
      }
      const [usual, { r }] = [...counts].sort((a, b) => b[1].n - a[1].n)[0];
      return { task, color: rs[0].color, time: shortTime(r.starts_at, r.ends_at), usual };
    });
}

/** The lines of one row at a given width: performers, plus one line per extra performer. */
const itemLines = (it: SheetItem) => Math.max(1, it.performers.length) + (it.time ? 1 : 0);

/** Font size that fits `lines` text lines and `rows` rows into the table height. */
export function fitFont(lines: number, rows: number): number {
  const pt = (TABLE_MM - rows * ROW_PAD_MM) / (lines * LINE * MM_PER_PT);
  return Math.min(MAX_PT, Math.floor(pt * 10) / 10);
}

/**
 * One month into one page – or halves, thirds… when one page would need a font below
 * MIN_PT, so a sheet on the notice board is always readable.
 */
export function buildSheet(
  rows: BoardRow[],
  year: number,
  month: number,
  holidays: Map<string, string>,
  monthTitle: string,
): SheetPage[] {
  const days = monthDays(year, month);
  const mine = rows.filter((r) => dayKey(r.starts_at).startsWith(days[0].slice(0, 7)));
  const cols = sheetColumns(mine);
  const sheetDays: SheetDay[] = days.map((day, i) => {
    const wd = new Date(day + "T12:00:00Z").getUTCDay();
    const cells = cols.map((c) =>
      mine
        .filter((r) => dayKey(r.starts_at) === day && r.task_name === c.task)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .map((r) => ({ performers: r.performers, reserves: r.reserves, time: timeKey(r) === c.usual ? null : timeWords(r.starts_at, r.ends_at) })),
    );
    const holiday = holidays.get(day) ?? null;
    // a holiday's name goes under the date: the row is at least two lines
    const lines = Math.max(holiday ? 2 : 1, ...cells.map((items) => items.reduce((n, it) => n + itemLines(it), 0)));
    return { day, date: i + 1, weekday: wd, weekend: wd === 5 || wd === 6, weekStart: wd === 0 && i > 0, holiday, cells, lines };
  });
  const changed = mine.filter((r) => r.changed_after_publish).map((r) => r.updated_at).sort();
  const updated = changed.length ? changed[changed.length - 1] : null;
  const columns = cols.map(({ task, color, time }) => ({ task, color, time }));

  const page = (ds: SheetDay[], title: string): SheetPage => ({
    title,
    columns,
    days: ds,
    fontPt: fitFont(ds.reduce((n, d) => n + d.lines, 0), ds.length),
    count: ds.reduce((n, d) => n + d.cells.reduce((m, c) => m + c.length, 0), 0),
    updated,
  });
  // as few pages as keep the font readable: the whole month, else halves, thirds…
  for (let parts = 1; parts <= sheetDays.length; parts++) {
    const size = Math.ceil(sheetDays.length / parts);
    const chunks = Array.from({ length: Math.ceil(sheetDays.length / size) }, (_, k) => sheetDays.slice(k * size, (k + 1) * size));
    const pages = chunks.map((ds) => page(ds, chunks.length === 1 ? monthTitle : `${monthTitle} · ${ds[0].date}–${ds[ds.length - 1].date}`));
    if (pages.every((x) => x.fontPt >= MIN_PT)) return pages;
  }
  return sheetDays.map((d) => page([d], `${monthTitle} · ${d.date}`));
}
