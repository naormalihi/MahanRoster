import { describe, expect, it } from "vitest";
import { addMonths, dm, nextRotaDay, rotaDays, rotaGaf, rotaMonthOver } from "./frameRota";

describe("frame rota", () => {
  const order = ["a", "b", "c", "d", "e", "f"];

  it("passes the frames month by month, twice a year with six", () => {
    expect(rotaGaf(order, "2027-01-01", "2027-01-15")).toBe("a");
    expect(rotaGaf(order, "2027-01-01", "2027-07-01")).toBe("a");
    expect(rotaGaf(order, "2027-01-01", "2027-06-01")).toBe("f");
    expect(rotaGaf(order, "2027-01-01", "2026-11-01")).toBe("e"); // before the start too
    expect(rotaGaf(order, "2027-01-01", "2027-02-01", { "2027-02-01": "e" })).toBe("e");
    expect(rotaGaf([], "2027-01-01", "2027-02-01")).toBeNull();
  });

  it("moves a holiday day to the next working day", () => {
    const off = (d: string) => ({ "2027-10-03": "ראש השנה ב׳", "2027-10-10": "ערב יום כיפור", "2027-10-11": "יום כיפור" } as Record<string, string>)[d] ?? null;
    const days = rotaDays(0, "2027-10-01", off);
    expect(days.map((d) => [d.planned, d.actual])).toEqual([
      ["2027-10-03", "2027-10-04"], ["2027-10-10", "2027-10-12"], ["2027-10-17", "2027-10-17"],
      ["2027-10-24", "2027-10-24"], ["2027-10-31", "2027-10-31"],
    ]);
    expect(days[1].why).toBe("ערב יום כיפור, יום כיפור");
  });

  it("skips a weekend after a Thursday holiday", () => {
    const off = (d: string) => (d === "2027-01-07" ? "חג" : ["2027-01-08", "2027-01-09"].includes(d) ? "" : null);
    expect(rotaDays(4, "2027-01-01", off)[0]).toEqual({ planned: "2027-01-07", actual: "2027-01-10", why: "חג" });
  });

  it("knows the next day and when the month is over", () => {
    const days = rotaDays(0, "2026-11-01", () => null);
    expect(nextRotaDay(days, "2026-11-28")?.planned).toBe("2026-11-29");
    expect(rotaMonthOver(days, "2026-11-30")).toBe(true);
    expect(addMonths("2026-12-01", 1)).toBe("2027-01-01");
    expect(dm("2027-10-04")).toBe("4.10");
  });
});
