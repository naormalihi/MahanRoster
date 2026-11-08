import { describe, expect, it } from "vitest";
import { groupByDay, isWeekend, people, shortGaf, span } from "../board";
import type { BoardRow } from "../api";

const row = (id: string, starts: string, ends: string, task = "t"): BoardRow => ({
  slot_id: id, starts_at: starts, ends_at: ends, task_name: task, category_name: null, color: null, performers: [], reserves: [],
  gafim: [], report_at: null, report_place: null, briefing_at: null, briefing_place: null, updated_at: starts, changed_after_publish: false,
});

describe("board", () => {
  it("shortens a gaf given as a framework path", () => {
    expect(shortGaf('מה"ן - מלמסים/גף בדיקות/צוות ביצועים - מלמסים')).toBe("גף בדיקות");
    expect(shortGaf("גף ענן")).toBe("גף ענן");
    expect(people(["א", "ב"], ["גף ענן", 'מה"ן/גף מערכות/צוות'])).toEqual([{ name: "א", gaf: "גף ענן" }, { name: "ב", gaf: "גף מערכות" }]);
  });
  it("labels same-day, next-day and multi-day spans", () => {
    expect(span("2027-01-05T06:00:00Z", "2027-01-05T15:00:00Z")).toEqual({ from: "08:00", to: "17:00", until: null });
    expect(span("2027-01-05T06:00:00Z", "2027-01-06T06:00:00Z").until).toBe("למחרת");
    expect(span("2027-01-06T11:00:00Z", "2027-01-13T11:00:00Z").until).toMatch(/13\.1/);
  });
  it("groups by local day and knows the weekend", () => {
    const g = groupByDay([row("b", "2027-01-05T06:00:00Z", "2027-01-05T07:00:00Z"), row("a", "2027-01-04T22:30:00Z", "2027-01-05T06:00:00Z")]);
    expect(g.map(([d, rs]) => [d, rs.length])).toEqual([["2027-01-05", 2]]);
    expect(isWeekend("2027-01-01")).toBe(true);
    expect(isWeekend("2027-01-03")).toBe(false);
  });
});

describe("calendar views", () => {
  it("builds a month of Sunday-first weeks", async () => {
    const { monthGrid } = await import("../board");
    const g = monthGrid(2027, 1); // January 2027 starts on a Friday
    expect(g[0]).toEqual(["2026-12-27", "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
    expect(g[g.length - 1]).toContain("2027-01-31");
    expect(g.every((w) => w.length === 7)).toBe(true);
  });
  it("summarizes days and builds the week table", async () => {
    const { daySummaries, weekMatrix, weekDays } = await import("../board");
    const rs = [
      { ...row("a", "2027-01-05T06:00:00Z", "2027-01-06T06:00:00Z", "קצין תורן"), performers: ["דנה"] },
      row("b", "2027-01-05T10:00:00Z", "2027-01-05T15:00:00Z", "קצין תורן"),
      { ...row("c", "2027-01-06T11:00:00Z", "2027-01-13T11:00:00Z", "שמירות"), performers: ["יוסי"] },
    ];
    expect(daySummaries(rs).get("2027-01-05")).toEqual({ types: [{ name: "קצין תורן", color: null, count: 2 }], total: 2, unstaffed: 1 });
    const m = weekMatrix(rs, weekDays("2027-01-03"));
    expect(m.map((x) => x.task)).toEqual(["קצין תורן", "שמירות"]);
    expect(m[0].byDay.get("2027-01-05")?.length).toBe(2);
  });
  it("exports one person's duties as a calendar file", async () => {
    const { dutiesIcs, matchingNames } = await import("../board");
    const rs = [
      { ...row("a", "2027-01-05T06:00:00Z", "2027-01-06T06:00:00Z", "קצין תורן"), performers: ["דנה כהן"], instructions: "ציוד: נשק, אפוד" },
      { ...row("b", "2027-01-07T06:00:00Z", "2027-01-08T06:00:00Z", "מפקד שער"), reserves: ["דנה כהן"] },
      { ...row("c", "2027-01-07T06:00:00Z", "2027-01-08T06:00:00Z", "מפקד שער"), performers: ["דנה לוי"] },
    ];
    expect(matchingNames(rs, "דנה")).toEqual(["דנה כהן", "דנה לוי"]);
    const { ics, count } = dutiesIcs(rs, "דנה כהן", new Date("2026-11-08T10:00:00Z"));
    expect(count).toBe(2);
    expect(ics).toContain("DTSTART:20270105T060000Z");
    expect(ics).toContain("SUMMARY:עתודה – מפקד שער");
    expect(ics).toContain("ציוד: נשק\\, אפוד");
    expect(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
});
