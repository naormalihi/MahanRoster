import { describe, expect, it } from "vitest";
import { cycleScores, lastPublishedCycle, summarize } from "../lastCycle";
import type { Cycle } from "../cycles";
import type { DraftAssignment } from "../draft";

const cyc = (id: string, start: string, status: string) => ({ id, start_date: start, status }) as unknown as Cycle;
const a = (soldier_id: string, normalized_points: number, role = "performer", status = "done") =>
  ({ soldier_id, normalized_points, role, status }) as unknown as DraftAssignment;

describe("last cycle reference", () => {
  it("is the latest published or closed cycle", () => {
    expect(lastPublishedCycle([cyc("a", "2026-07-01", "closed"), cyc("b", "2027-01-01", "published"), cyc("c", "2027-07-01", "review")])?.id).toBe("b");
    expect(lastPublishedCycle([cyc("c", "2027-07-01", "review")])).toBeUndefined();
  });

  it("sums the duties that stood and summarizes per group, zeros included", () => {
    const s = cycleScores([a("A", 3), a("A", 2), a("A", 9, "reserve"), a("B", 4, "performer", "dropped"), a("B", 1)]);
    expect(s.get("A")).toEqual({ points: 5, duties: 2 });
    expect(s.get("B")).toEqual({ points: 1, duties: 1 });
    const sum = summarize(
      [
        { soldier_id: "A", group: "חובה" },
        { soldier_id: "B", group: "חובה" },
        { soldier_id: "C", group: "חובה" },
        { soldier_id: "D", group: "קבע" },
      ],
      s,
    );
    expect(sum).toEqual([
      { key: "חובה", n: 3, mean: 2, min: 0, max: 5, zero: 1 },
      { key: "קבע", n: 1, mean: 0, min: 0, max: 0, zero: 1 },
    ]);
  });
});

describe("current and next cycle by today's date", () => {
  const c = (id: string, start: string, end: string, status = "published") => ({ id, start_date: start, end_date: end, status }) as unknown as Cycle;
  const cycles = [c("h1", "2027-01-01", "2027-06-30"), c("h2", "2027-07-01", "2027-12-31", "review")];
  it("between cycles: no current one, the next is the coming half-year", async () => {
    const { currentCycle, nextCycle } = await import("../lastCycle");
    expect(currentCycle(cycles, "2026-11-15")).toBeUndefined();
    expect(nextCycle(cycles, "2026-11-15")?.id).toBe("h1");
  });
  it("once a cycle starts it is current and the one after it is next", async () => {
    const { currentCycle, nextCycle } = await import("../lastCycle");
    expect(currentCycle(cycles, "2027-01-01")?.id).toBe("h1");
    expect(nextCycle(cycles, "2027-01-01")?.id).toBe("h2");
  });
  it("current score: opening score alone, or opening plus the cycle's points", async () => {
    const { currentScore } = await import("../lastCycle");
    expect(currentScore(null, undefined, false)).toBeNull();
    expect(currentScore(10.9, undefined, false)).toEqual({ points: 10.9, duties: 0, opening: 10.9 });
    expect(currentScore(10.9, { points: 3, duties: 2 }, true)).toEqual({ points: 13.9, duties: 2, opening: 10.9 });
    expect(currentScore(null, undefined, true)).toEqual({ points: 0, duties: 0, opening: 0 });
  });
});
