import { describe, expect, it } from "vitest";
import type { BoardRow } from "../api";
import { buildSheet, fitFont, MAX_PT, MIN_PT, monthDays, sheetColumns, timeWords } from "../printSheet";

const row = (id: string, starts: string, ends: string, task: string, o: Partial<BoardRow> = {}): BoardRow => ({
  slot_id: id, starts_at: starts, ends_at: ends, task_name: task, category_name: null, color: null, performers: ["א"], reserves: ["ב"],
  gafim: [], report_at: null, report_place: null, briefing_at: null, briefing_place: null, updated_at: starts, changed_after_publish: false, ...o,
});
// 08:00 Israel time in January = 06:00Z
const day24 = (d: number, task = "קצין תורן", id = `${task}${d}`) =>
  row(id, `2027-01-${String(d).padStart(2, "0")}T06:00:00Z`, `2027-01-${String(d + 1).padStart(2, "0")}T06:00:00Z`, task);

describe("print sheet", () => {
  it("says the hours in words, without +1", () => {
    expect(timeWords("2027-01-05T06:00:00Z", "2027-01-05T15:00:00Z")).toBe("08:00–17:00");
    expect(timeWords("2027-01-05T06:00:00Z", "2027-01-06T06:00:00Z")).toBe("יממה · 08:00");
    expect(timeWords("2027-01-05T11:00:00Z", "2027-01-06T07:00:00Z")).toBe("13:00–09:00 למחרת");
  });

  it("puts the usual hours in the column head and only other hours in a cell", () => {
    const rows = [day24(3), day24(4), row("x", "2027-01-05T08:00:00Z", "2027-01-06T08:00:00Z", "קצין תורן")];
    const [c] = sheetColumns(rows);
    expect(c.time).toBe("יממה 08");
    const [page] = buildSheet(rows, 2027, 1, new Map(), "ינואר 2027");
    const cell = (d: number) => page.days[d - 1].cells[0];
    expect(cell(3)[0].time).toBeNull();
    expect(cell(5)[0].time).toBe("יממה · 10:00");
  });

  it("orders columns by category then name, and marks weeks, weekends and holidays", () => {
    const rows = [day24(3, "ב", "1"), day24(4, "א", "2"), { ...day24(5, "ג", "3"), category_name: "א" }];
    const [page] = buildSheet(rows, 2027, 1, new Map([["2027-01-10", "חג"]]), "ינואר 2027");
    expect(page.columns.map((c) => c.task)).toEqual(["א", "ב", "ג"]);
    expect(page.days).toHaveLength(31);
    expect(page.days[0].weekend).toBe(true); // 1.1.2027 is a Friday
    expect(page.days[2].weekStart).toBe(true); // Sunday 3.1
    expect(page.days.filter((d) => d.weekStart).map((d) => d.date)).toEqual([3, 10, 17, 24, 31]);
    expect(page.days[9].holiday).toBe("חג");
    expect(page.count).toBe(3);
  });

  it("notes the last change after publishing", () => {
    const rows = [day24(3), { ...day24(4), changed_after_publish: true, updated_at: "2027-01-02T10:00:00Z" }];
    expect(buildSheet(rows, 2027, 1, new Map(), "x")[0].updated).toBe("2027-01-02T10:00:00Z");
  });

  it("fits the font to the page and splits a month too full to read", () => {
    expect(fitFont(31, 31)).toBe(MAX_PT);
    expect(fitFont(200, 31)).toBeLessThan(MIN_PT);
    // a normal month: one page
    expect(buildSheet([day24(3), day24(4)], 2027, 1, new Map(), "x")).toHaveLength(1);
    // five duties of one type every day: two pages, each readable
    const full = monthDays(2027, 1).flatMap((_, i) => [1, 2, 3, 4, 5, 6, 7].map((k) => day24(Math.min(i + 1, 30), "ש", `${i}-${k}`)));
    const pages = buildSheet(full, 2027, 1, new Map(), "ינואר");
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0].title).toMatch(/^ינואר · 1–\d+$/);
    expect(pages.every((p) => p.fontPt >= MIN_PT)).toBe(true);
    expect(pages.flatMap((p) => p.days)).toHaveLength(31);
  });
});
