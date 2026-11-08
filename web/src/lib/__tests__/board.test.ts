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
