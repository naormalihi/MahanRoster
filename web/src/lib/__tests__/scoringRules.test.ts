import { describe, expect, it } from "vitest";
import { orList, additionLabel, additionsByValue, buildExamples, exampleTask, loadRoleExamples, num, taskNote, type ScoringRules } from "../scoringRules";

// the unit's catalog as it is (weights and additions), names included
const rules: ScoringRules = {
  tasks: [
    { name: "אמ\"ת", weight: 13, includes_holidays: true, weekend_type: true, category: null },
    { name: "הגנ\"ש", weight: 9, includes_holidays: true, weekend_type: true, category: null },
    { name: "מטבח", weight: 4, includes_holidays: false, weekend_type: false, category: null },
    { name: "קצין הגנ\"ק", weight: 2.6, includes_holidays: false, weekend_type: true, category: null },
    { name: "מפקד שער", weight: 2.6, includes_holidays: false, weekend_type: false, category: null },
    { name: "קצין תורן", weight: 1, includes_holidays: false, weekend_type: false, category: null },
    { name: "רס\"ר", weight: 7, includes_holidays: false, weekend_type: false, category: null },
    { name: "רס\"ר הקלת ת\"ש", weight: 5, includes_holidays: false, weekend_type: false, category: null },
  ],
  additions: [
    { name: "ראש השנה · ערב חג", value: 6 },
    { name: "סוף שבוע", value: 3 },
    { name: "פסח · ערב חג", value: 6 },
    { name: "פסח · החג", value: 3 },
    { name: "פסח · חול המועד", value: 3 },
  ],
  surprise_multiplier: 1.3,
  surprise_notice_hours: 72,
  window_months: 6,
  fairness_tolerance_pct: 20,
};

describe("scoring rules", () => {
  it("formats numbers without trailing zeros", () => {
    expect(num(4)).toBe("4");
    expect(num(1.3)).toBe("1.3");
    expect(num(2.255)).toBe("2.26");
  });

  it("names a holiday addition the way people say it", () => {
    expect(additionLabel("פסח · ערב חג")).toBe("ערב פסח");
    expect(additionLabel("פסח · החג")).toBe("פסח");
    expect(additionLabel("סוכות · חול המועד")).toBe("חול המועד סוכות");
    expect(additionLabel("סוף שבוע")).toBe("סוף שבוע");
  });

  it("groups the additions by value", () => {
    expect(additionsByValue(rules)).toEqual([
      { value: 6, names: ["ערב ראש השנה", "ערב פסח"] },
      { value: 3, names: ["סוף שבוע", "פסח", "חול המועד פסח"] },
    ]);
  });

  it("says what a weight already covers", () => {
    expect(taskNote(rules.tasks[0])).toBe("קבוע, בלי תוספות");
    expect(taskNote(rules.tasks[3])).toBe("בלי תוספת סוף שבוע");
    expect(taskNote(rules.tasks[2])).toBeNull();
  });

  it("shows the examples on a middle-weight duty that takes every addition", () => {
    expect(exampleTask(rules)?.name).toBe("מטבח"); // weights 1, 2.6, 4, 5, 7 → 4
    expect(exampleTask({ ...rules, tasks: [] })).toBeNull();
  });

  it("adds the highest addition once and multiplies a call-up last", () => {
    expect(buildExamples(rules).map((e) => [e.title, e.calc, e.result])).toEqual([
      ["מטבח ביום רגיל", "4", 4],
      ["מטבח בערב ראש השנה", "4 + 6", 10],
      ["מטבח בערב ראש השנה, בהקפצה", "(4 + 6) × 1.3", 13],
    ]);
  });

  it("lists names with \"או\"", () => {
    expect(orList(["קורס"])).toBe("קורס");
    expect(orList(["מחלה", "קורס", "מילואים"])).toBe("מחלה, קורס או מילואים");
  });

  it("without additions: a regular day and a call-up", () => {
    expect(buildExamples({ ...rules, additions: [] }).map((e) => e.calc)).toEqual(["4", "4 × 1.3"]);
  });

  it("relief roles: points divided by the factor, lowest first, a factor of 1 left out", () => {
    const r = { ...rules, load_roles: [{ name: "כונן מבצעי", factor: 0.7 }, { name: "ראש צוות", factor: 0.5 }, { name: "רגיל", factor: 1 }] };
    expect(loadRoleExamples(r).map((e) => [e.name, e.calc, e.result])).toEqual([
      ["ראש צוות", "4 ÷ 0.5", 8],
      ["כונן מבצעי", "4 ÷ 0.7", 5.71],
    ]);
    expect(loadRoleExamples(rules)).toEqual([]);
  });
});
