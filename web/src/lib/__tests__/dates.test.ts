import { describe, expect, it } from "vitest";
import { dayKey, shortDayLabel, spanLabel, upcomingWeekend } from "../dates";

describe("dates (Asia/Jerusalem)", () => {
  it("day key follows Israel time, not UTC", () => {
    expect(dayKey("2027-01-06T22:30:00Z")).toBe("2027-01-07"); // 00:30 in Israel
  });
  it("labels spans", () => {
    expect(spanLabel("2027-01-04T06:00:00Z", "2027-01-04T14:00:00Z")).toBe("08:00 – 16:00");
    expect(spanLabel("2027-01-04T06:00:00Z", "2027-01-05T06:00:00Z")).toBe("08:00 – 08:00 למחרת");
    expect(spanLabel("2027-01-08T06:00:00Z", "2027-01-10T06:00:00Z")).toMatch(/^08:00 – 08:00, /);
    expect(shortDayLabel("2027-01-04T06:00:00Z")).toBe("יום ב׳, 4.1");
  });
  it("upcoming weekend starts Thursday evening", () => {
    const [from, to] = upcomingWeekend(new Date(2027, 0, 4, 12)); // Monday
    expect(from.getDay()).toBe(4);
    expect(to.getDay()).toBe(0);
  });
});
