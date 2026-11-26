import { expect, test } from "vitest";
import { plannedRangeProblems, rangeWhen, validUntil } from "../range";

test("validity: last range + months, clamped to the month's end", () => {
  expect(validUntil("2026-11-26", 6)).toBe("2027-05-26");
  expect(validUntil("2026-08-31", 6)).toBe("2027-02-28");
  expect(validUntil("2026-12-15", 1)).toBe("2027-01-15");
});

test("planned range", () => {
  expect(plannedRangeProblems({ day: "2026-12-01", starts: "10:00", ends: "08:00", place: null, note: null }, "2026-11-26")).toEqual([
    "שעת הסיום לפני ההתחלה",
  ]);
  expect(plannedRangeProblems({ day: "2026-11-01", starts: null, ends: null, place: null, note: null }, "2026-11-26")).toEqual(["התאריך כבר עבר"]);
  expect(rangeWhen({ day: "2026-12-01", starts: "08:00", ends: "12:00", place: "צפון" })).toBe("01/12/2026 08:00–12:00, צפון");
});
