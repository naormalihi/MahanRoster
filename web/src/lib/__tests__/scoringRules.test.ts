import { describe, expect, it } from "vitest";
import { buildExamples, exampleTask, num, type ScoringRules } from "../scoringRules";

const rules: ScoringRules = {
  tasks: [
    { name: "שמירה", weight: 2, includes_holidays: false, category: "שמירות" },
    { name: "מטבח", weight: 4, includes_holidays: false, category: "משק" },
    { name: "תורן שבועי", weight: 10, includes_holidays: true, category: "משק" },
    { name: "קצין תורן", weight: 6, includes_holidays: false, category: null },
  ],
  additions: [
    { name: "ערב חג", value: 3 },
    { name: "חג", value: 6 },
  ],
  surprise_multiplier: 1.5,
  surprise_notice_hours: 72,
  window_months: 6,
  fairness_tolerance_pct: 20,
};

describe("scoring rules", () => {
  it("formats numbers without trailing zeros", () => {
    expect(num(4)).toBe("4");
    expect(num(1.5)).toBe("1.5");
    expect(num(2.255)).toBe("2.26");
  });

  it("shows the examples on a middle task that takes holiday additions", () => {
    expect(exampleTask(rules)?.name).toBe("מטבח");
    expect(exampleTask({ ...rules, tasks: [] })).toBeNull();
  });

  it("adds the highest addition and multiplies a call-up last", () => {
    expect(buildExamples(rules).map((e) => [e.calc, e.result])).toEqual([
      ["4", 4],
      ["4 + 6", 10],
      ["(4 + 6) × 1.5", 15],
    ]);
  });

  it("without additions: a regular day and a call-up", () => {
    expect(buildExamples({ ...rules, additions: [] }).map((e) => e.calc)).toEqual(["4", "4 × 1.5"]);
  });
});
