import { describe, expect, it } from "vitest";
import { israeliHolidays, mergeHolidays, scoringProblems, taskTypeProblems, type TaskTypeInput } from "../catalog";

const base: TaskTypeInput = {
  code: "new_duty",
  name: "תורנות חדשה",
  category_id: null,
  weight: 1,
  min_rest_hours: 0,
  service_restriction: "any",
  requires_weapon: false,
  is_weekend_type: false,
  shachar_compatible: false,
  qualifying_duty: false,
  eligible_populations: [],
  rank_min_id: null,
  rank_max_id: null,
  gender: null,
  default_start_time: null,
  default_end_time: null,
  weekday_hours: null,
  color: null,
  is_active: true,
};

describe("catalog validation", () => {
  const others = [{ id: "a", code: "hagnash", name: "הגנ\"ש" }];
  it("accepts a valid duty", () => expect(taskTypeProblems(base, others)).toEqual([]));
  it("rejects duplicates, bad code and weight", () => {
    expect(taskTypeProblems({ ...base, code: "hagnash" }, others)).toHaveLength(1);
    expect(taskTypeProblems({ ...base, code: "hagnash" }, others, "a")).toEqual([]);
    expect(taskTypeProblems({ ...base, code: "Bad Code" }, others)).toHaveLength(1);
    expect(taskTypeProblems({ ...base, weight: 0 }, others)).toHaveLength(1);
    expect(taskTypeProblems({ ...base, default_start_time: "08:00" }, others)).toHaveLength(1);
  });
  it("scoring settings", () => {
    const ok = { weekend_multiplier: 1.5, holiday_multiplier: 2, night_multiplier: 1.25, night_window: "22:00-06:00", weekend_weekdays: [5, 6] };
    expect(scoringProblems(ok)).toEqual([]);
    expect(scoringProblems({ ...ok, holiday_multiplier: 0.5, night_window: "22-6", weekend_weekdays: [] })).toHaveLength(3);
  });
});

describe("Israeli holidays", () => {
  const days = israeliHolidays("2026-09-01", "2027-08-31");
  const at = (d: string) => days.find((x) => x.day === d);
  it("marks the main holidays and eves (Israel schedule)", () => {
    expect(at("2026-09-11")?.day_type).toBe("holiday_eve");
    expect(at("2026-09-12")?.day_type).toBe("holiday");
    expect(at("2026-09-13")?.day_type).toBe("holiday");
    expect(at("2026-09-21")?.note).toBe("יום כיפור");
    expect(at("2026-10-03")?.day_type).toBe("holiday");
    expect(at("2027-04-22")?.day_type).toBe("holiday");
    expect(at("2027-04-28")?.day_type).toBe("holiday");
    expect(at("2027-05-11")?.day_type).toBe("memorial");
    expect(at("2027-05-12")?.day_type).toBe("holiday");
    expect(at("2027-06-11")?.note).toBe("שבועות");
  });
  it("skips chol hamoed and minor days", () => {
    expect(at("2026-09-28")).toBeUndefined();
    expect(at("2026-12-05")).toBeUndefined();
    expect(at("2027-03-23")).toBeUndefined();
  });
  it("never overwrites manual entries", () => {
    const existing = [
      { day: "2026-09-12", day_type: "holiday" as const, source: "manual" as const, note: "שלי" },
      { day: "2026-09-21", day_type: "holiday" as const, source: "hebcal" as const, note: "יום כיפור" },
    ];
    const { toWrite, keptManual } = mergeHolidays(existing, days);
    expect(keptManual).toBe(1);
    expect(toWrite.find((d) => d.day === "2026-09-12")).toBeUndefined();
    expect(toWrite.find((d) => d.day === "2026-09-21")).toBeUndefined();
    expect(toWrite.length).toBe(days.length - 2);
  });
});
