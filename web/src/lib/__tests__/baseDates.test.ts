import { describe, expect, it } from "vitest";
import { readDates, readRows, slotTimes } from "../baseSchedule";

describe("dates in the task file", () => {
  it("reads a range of days: same month, across months and years, with dots", () => {
    expect(readDates("18-21/3/2027")).toEqual({ start: "2027-03-18", end: "2027-03-21" });
    expect(readDates("29/4-2/5/2027")).toEqual({ start: "2027-04-29", end: "2027-05-02" });
    expect(readDates("28/12-3/1/2027")).toEqual({ start: "2026-12-28", end: "2027-01-03" });
    expect(readDates("30/12/2026-2/1/2027")).toEqual({ start: "2026-12-30", end: "2027-01-02" });
    expect(readDates("26/5-2-6/2027")).toEqual({ start: "2027-05-26", end: "2027-06-02" }); // a slip in the file
    expect(readDates(" 6 – 13.1.27 ")).toEqual({ start: "2027-01-06", end: "2027-01-13" });
  });

  it("still reads one date, and refuses a broken range", () => {
    expect(readDates("18/3/2027")).toEqual({ start: "2027-03-18", end: "2027-03-18" });
    expect(readDates("18-3-2027")).toEqual({ start: "2027-03-18", end: "2027-03-18" }); // one date with dashes
    expect(readDates(46829)).toEqual({ start: "2028-03-17", end: "2028-03-17" }); // an Excel serial
    expect(readDates("21-18/3/2027")).toBe("invalid"); // ends before it starts
    expect(readDates("30-31/2/2027")).toBe("invalid");
    expect(readDates("1/1-15/3/2027")).toBe("too_long");
    expect(readDates("")).toBeNull();
  });

  it("a row with a range is one slot, from the first day's hours to the last day's", () => {
    const { rows, errors } = readRows([["מועד", "משימה"], ["6-13/1/2027", 'רס"ר'], ["18/3/2027", "מטבח"]]);
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.start, r.end])).toEqual([["2027-01-06", "2027-01-13"], ["2027-03-18", "2027-03-18"]]);
    const t = slotTimes("2027-01-06", "2027-01-13", { default_start_time: "08:00", default_end_time: "08:00" });
    expect(t).toEqual({ starts_at: "2027-01-06T08:00:00+02:00", ends_at: "2027-01-13T08:00:00+02:00" });
  });
});
