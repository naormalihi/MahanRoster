import { describe, expect, it } from "vitest";
import { cellText, exportSheets, heat, overrideProblems, summarize, weekly, type PotentialCell } from "../potential";

const cell = (soldier_id: string, category_id: string, value: number, override_value: number | null = null): PotentialCell => ({
  soldier_id, category_id, value, override_value, override_reason: override_value === null ? null : "x",
  best_task_type_id: "t", reasons: value ? [] : ["rank"], available_days: 0, cycle_days: 182,
});

describe("potential", () => {
  const cells = [cell("a", "k1", 1), cell("b", "k1", 0.67), cell("c", "k1", 0, 0.5), cell("a", "k2", 0), cell("b", "k2", 1, 0)];
  it("formats cells", () => {
    expect([cellText(1), cellText(0), cellText(0.5)]).toEqual(["1", "", "0.50"]);
  });
  it("sums per category with overrides", () => {
    const [k1, k2] = summarize(cells, ["k1", "k2"]);
    expect(k1).toEqual({ category_id: "k1", total: 2.17, full: 1, partial: 2, overrides: 1 });
    expect(k2).toEqual({ category_id: "k2", total: 0, full: 0, partial: 0, overrides: 1 });
  });
  it("validates overrides", () => {
    expect(overrideProblems(0.5, "סיבה")).toBeNull();
    expect(overrideProblems(1.2, "סיבה")).not.toBeNull();
    expect(overrideProblems(0.555, "סיבה")).not.toBeNull();
    expect(overrideProblems(0.5, " ")).not.toBeNull();
  });
  it("builds the export: summary and names of eligible soldiers only", () => {
    const soldiers = [
      { id: "a", full_name: "א", gaf_name: "ג1", rank_name: "סמל" },
      { id: "b", full_name: "ב", gaf_name: "ג1", rank_name: "סגן" },
      { id: "c", full_name: "ג", gaf_name: "ג2", rank_name: "סרן" },
      { id: "d", full_name: "ד", gaf_name: "ג2", rank_name: "סא\"ל" },
    ];
    const { summaryRows, nameRows } = exportSheets(soldiers, [{ id: "k1", name: "קצין תורן" }, { id: "k2", name: "הגנ\"ש" }], cells, "מחזור");
    expect(summaryRows[3]).toEqual(["קצין תורן", 2.17, 1, 2]);
    expect(nameRows.map((r) => r[0])).toEqual(["שם מלא", "א", "ב", "ג"]);
    expect(nameRows[2]).toEqual(["ב", "ג1", "סגן", 0.67, null]);
  });
  it("finds the worst day of each week (weeks start Sunday)", () => {
    const daily = [
      { day: "2026-12-05", category_id: "k", available: 9 }, // Saturday
      { day: "2026-12-06", category_id: "k", available: 7 }, // Sunday
      { day: "2026-12-08", category_id: "k", available: 5 },
      { day: "2026-12-13", category_id: "k", available: 8 },
    ];
    expect(weekly(daily, "k")).toEqual([
      { week_start: "2026-11-29", min: 9, worst_day: "2026-12-05" },
      { week_start: "2026-12-06", min: 5, worst_day: "2026-12-08" },
      { week_start: "2026-12-13", min: 8, worst_day: "2026-12-13" },
    ]);
    expect(heat(5, [5, 8, 9])).toBe(0);
    expect(heat(4, [4, 4])).toBe(1);
  });
});
