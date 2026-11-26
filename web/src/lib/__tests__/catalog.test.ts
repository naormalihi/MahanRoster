import { describe, expect, it } from "vitest";
import { briefingLabel, briefingProblems, cleanBriefing, EMPTY_MULTIPLIER, describeMultiplier, israeliHolidays, mergeHolidays, multiplierProblems, scoringProblems, taskTypeProblems, type TaskTypeInput } from "../catalog";

const base: TaskTypeInput = {
  code: "new_duty",
  name: "משימה חדשה",
  category_id: null,
  weight: 1,
  min_rest_hours: 0,
  service_restriction: "any",
  requires_weapon: false,
  is_weekend_type: false,
  includes_holidays: false,
  shachar_compatible: false,
  shachar_only: false,
  tash_rule: "auto",
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
    const ok = { night_window: "22:00-06:00", weekend_weekdays: [5, 6], surprise_multiplier: 1.5, surprise_notice_hours: 72, exemption_deadline_days: 40, fairness_tolerance_pct: 20, grace_days: 90, briefing_reminder_hours: 24, ack_reminder_hours: 48, ack_escalation_hours: 24, range_validity_months: 6, range_warning_days: 14, range_notice_days: 30 };
    expect(scoringProblems(ok)).toEqual([]);
    expect(scoringProblems({ night_window: "22-6", weekend_weekdays: [], surprise_multiplier: 0.5, surprise_notice_hours: 0, exemption_deadline_days: 0, fairness_tolerance_pct: 0, grace_days: -1, briefing_reminder_hours: 1, ack_reminder_hours: -1, ack_escalation_hours: 200, range_validity_months: 6, range_warning_days: 14, range_notice_days: 30 })).toHaveLength(10);
  });
  it("briefing: label, problems, clean", () => {
    expect(briefingLabel({ kind: "briefing", rule: "weekday", weekday: 2, time: "13:00", place: "גף אבטחה פיזית" })).toBe("תדריך שלישי שלפני 13:00 · גף אבטחה פיזית");
    expect(briefingLabel({ kind: "report", rule: "same_day", time: "08:30" })).toBe("התייצבות ביום המשימה 08:30");
    expect(briefingLabel({ kind: "by_call" })).toBe("תדריך לפי הזימון");
    expect(briefingProblems({ kind: "briefing", rule: "same_day", time: "9" })).toHaveLength(1);
    expect(briefingProblems({ kind: "by_call" })).toEqual([]);
    expect(cleanBriefing({ kind: "by_call", rule: "weekday", weekday: 3, time: "10:00", place: "  ", note: " לא " })).toEqual({ kind: "by_call", note: "לא" });
    expect(cleanBriefing({ kind: "briefing", rule: "weekday", time: "13:00" })).toEqual({ kind: "briefing", rule: "weekday", time: "13:00", weekday: 2 });
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
    expect(describeMultiplier(m, (c) => (c === "holiday" ? "חג" : c))).toBe("חג · שישי, שבת · לא על משימות שבת");
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
  it("marks חול המועד and the observances that are not rest days", () => {
    expect(at("2026-09-28")).toMatchObject({ day_type: "chol_hamoed", holiday: "sukkot", holiday_kind: "chol_hamoed" });
    expect(at("2026-12-05")).toMatchObject({ day_type: "observance", holiday: "hanukkah", holiday_kind: "day" });
    expect(at("2027-03-23")).toMatchObject({ day_type: "observance", holiday: "purim", note: "פורים" });
    expect(at("2026-09-14")).toMatchObject({ day_type: "observance", holiday: "fast", note: "צום גדליה" });
    // a fast and ערב פורים on the same day: one row, the fast
    expect(at("2027-03-22")).toMatchObject({ holiday: "fast", note: "תענית אסתר" });
  });
  it("never overwrites manual entries", () => {
    const existing = [
      { day: "2026-09-12", day_type: "holiday" as const, source: "manual" as const, note: "שלי" },
      { day: "2026-09-21", day_type: "major_holiday" as const, source: "hebcal" as const, note: "יום כיפור", holiday: "yom_kippur" as const, holiday_kind: "day" as const },
    ];
    const { toWrite, keptManual } = mergeHolidays(existing, days);
    expect(keptManual).toBe(1);
    expect(toWrite.find((d) => d.day === "2026-09-12")).toBeUndefined();
    expect(toWrite.find((d) => d.day === "2026-09-21")).toBeUndefined();
    expect(toWrite.length).toBe(days.length - 2);
  });
});

import { calendarMatch, EMPTY_MULTIPLIER as EMPTY_M, israeliHolidays as hol } from "../catalog";

describe("holidays by name", () => {
  it("marks every day of סוכות and פסח, with חול המועד", () => {
    const sukkot = hol("2027-10-14", "2027-10-24").map((d) => `${d.holiday}/${d.holiday_kind}`);
    expect(sukkot).toEqual([
      "sukkot/eve", "sukkot/day", ...Array(5).fill("sukkot/chol_hamoed"), "sukkot/eve", "sukkot/day",
    ]);
    expect(hol("2027-04-20", "2027-04-29").filter((d) => d.holiday_kind === "chol_hamoed")).toHaveLength(4);
  });

  it("matches a multiplier by holiday and by day of it", () => {
    const days = hol("2027-09-30", "2027-10-24");
    const at = (iso: string) => days.find((d) => d.day === iso);
    const eves = { ...EMPTY_M, holidays: ["rosh_hashana", "yom_kippur", "sukkot", "pesach"] as const, holiday_kinds: ["eve"] as const };
    const m = { ...eves, holidays: [...eves.holidays], holiday_kinds: [...eves.holiday_kinds] };
    expect(calendarMatch(m, at("2027-10-15"))).toBe(true); // ערב סוכות
    expect(at("2027-10-15")?.day_type).toBe("major_holiday_eve"); // ערב סוכות is a major holiday eve
    expect(calendarMatch(m, at("2027-10-16"))).toBe(false); // סוכות itself
    const ch = { ...EMPTY_M, holiday_kinds: ["chol_hamoed" as const] };
    expect(calendarMatch(ch, at("2027-10-18"))).toBe(true);
    expect(calendarMatch(ch, undefined)).toBe(false);
    // a multiplier that names no holiday covers the rest days only, not חנוכה
    const anyDay = { ...EMPTY_M, holiday_kinds: ["day" as const] };
    const hanukkah = hol("2026-12-05", "2026-12-05")[0];
    expect(calendarMatch(anyDay, hanukkah)).toBe(false);
    expect(calendarMatch({ ...anyDay, holidays: ["hanukkah"] }, hanukkah)).toBe(true);
  });
});

describe("multiplier values", () => {
  it("are shown as an addition to the weight", async () => {
    const { multiplierValueLabel } = await import("../catalog");
    const eve = { ...EMPTY_MULTIPLIER, holiday_kinds: ["eve" as const], value: 6 };
    const weekend = { ...EMPTY_MULTIPLIER, weekdays: [5, 6], value: 3 };
    expect(multiplierValueLabel(eve)).toBe("+6");
    expect(multiplierValueLabel(weekend)).toBe("+3");
  });
});
