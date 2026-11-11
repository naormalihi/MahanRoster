import { describe, expect, it } from "vitest";
import { EMPTY_MULTIPLIER, describeMultiplier, israeliHolidays, mergeHolidays, multiplierProblems, scoringProblems, taskTypeProblems, type TaskTypeInput } from "../catalog";

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
  shachar_only: false,
  qualifying_duty: false,
  allowed_rank_ids: null,
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
  it("rejects duplicate names, bad weight and an empty rank list", () => {
    expect(taskTypeProblems({ ...base, name: "הגנ\"ש" }, others)).toHaveLength(1);
    expect(taskTypeProblems({ ...base, name: "הגנ\"ש" }, others, "a")).toEqual([]);
    expect(taskTypeProblems({ ...base, allowed_rank_ids: [] }, others)).toHaveLength(1);
    expect(taskTypeProblems({ ...base, weight: 0 }, others)).toHaveLength(1);
    expect(taskTypeProblems({ ...base, default_start_time: "08:00" }, others)).toHaveLength(1);
  });
  it("scoring settings", () => {
    const ok = { night_window: "22:00-06:00", weekend_weekdays: [5, 6], surprise_multiplier: 1.5, exemption_deadline_days: 40, fairness_tolerance_pct: 20 };
    expect(scoringProblems(ok)).toEqual([]);
    expect(scoringProblems({ night_window: "22-6", weekend_weekdays: [], surprise_multiplier: 0.5, exemption_deadline_days: 0, fairness_tolerance_pct: 0 })).toHaveLength(5);
  });
  it("a multiplier needs a name, a value 1–10 and at least one condition", () => {
    const all = [{ ...EMPTY_MULTIPLIER, id: "m1", name: "לילה", time_window: "22:00-06:00" }];
    expect(multiplierProblems({ ...EMPTY_MULTIPLIER, name: "זיכרון", day_types: ["memorial"] }, all)).toEqual([]);
    expect(multiplierProblems({ ...EMPTY_MULTIPLIER, name: "זיכרון" }, all)[0]).toMatch("לפחות תנאי");
    expect(multiplierProblems({ ...EMPTY_MULTIPLIER, name: "לילה", weekdays: [4] }, all)[0]).toMatch("כבר יש");
    expect(multiplierProblems({ ...EMPTY_MULTIPLIER, name: "x", value: 11, weekdays: [4] }, all)[0]).toMatch("בין 1 ל-10");
    expect(multiplierProblems({ ...EMPTY_MULTIPLIER, name: "x", date_from: "2027-02-01", date_to: "2027-01-01" }, all)[0]).toMatch("לפני");
  });
  it("describes when a multiplier applies", () => {
    const m = { ...EMPTY_MULTIPLIER, name: "x", day_types: ["holiday"], weekdays: [6, 5], skip_shabbat_types: true };
    expect(describeMultiplier(m, (c) => (c === "holiday" ? "חג" : c))).toBe("חג · שישי, שבת · לא על תורנויות שבת");
  });
});

describe("Israeli holidays", () => {
  const days = israeliHolidays("2026-09-01", "2027-08-31");
  const at = (d: string) => days.find((x) => x.day === d);
  it("marks the main holidays and eves (Israel schedule)", () => {
    // ראש השנה, יום כיפור and פסח (and their eves) are major holidays
    expect(at("2026-09-11")?.day_type).toBe("major_holiday_eve");
    expect(at("2026-09-12")?.day_type).toBe("major_holiday");
    expect(at("2026-09-13")?.day_type).toBe("major_holiday");
    expect(at("2026-09-21")?.note).toBe("יום כיפור");
    expect(at("2026-09-21")?.day_type).toBe("major_holiday");
    expect(at("2026-10-03")?.day_type).toBe("holiday");
    expect(at("2027-04-21")?.day_type).toBe("major_holiday_eve");
    expect(at("2027-04-22")?.day_type).toBe("major_holiday");
    expect(at("2027-04-28")?.day_type).toBe("major_holiday");
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
      { day: "2026-09-21", day_type: "major_holiday" as const, source: "hebcal" as const, note: "יום כיפור" },
    ];
    const { toWrite, keptManual } = mergeHolidays(existing, days);
    expect(keptManual).toBe(1);
    expect(toWrite.find((d) => d.day === "2026-09-12")).toBeUndefined();
    expect(toWrite.find((d) => d.day === "2026-09-21")).toBeUndefined();
    expect(toWrite.length).toBe(days.length - 2);
  });
});
