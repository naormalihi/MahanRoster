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
