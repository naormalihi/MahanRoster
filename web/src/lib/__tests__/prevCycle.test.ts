import { describe, expect, it } from "vitest";
import { prevCycle, prevMean, previousCycle } from "../prevCycle";
import type { Cycle } from "../cycles";
import type { DraftAssignment } from "../draft";

const cyc = (id: string, start: string, status: string) => ({ id, name: id, start_date: start, status }) as unknown as Cycle;
const a = (soldier_id: string, normalized_points: number, role = "performer", status = "done") =>
  ({ soldier_id, normalized_points, role, status }) as unknown as DraftAssignment;

describe("previous cycle reference", () => {
  it("is the last published cycle before this one", () => {
    const cur = cyc("c3", "2027-07-01", "review");
    const list = [cyc("c1", "2026-07-01", "closed"), cyc("c2", "2027-01-01", "published"), cyc("c4", "2028-01-01", "published"), cur];
    expect(previousCycle(list, cur)?.id).toBe("c2");
    expect(previousCycle([cur], cur)).toBeUndefined();
  });

  it("sums the points that stood and averages over who was there", () => {
    const p = prevCycle("ינואר", [a("A", 3), a("A", 2), a("A", 9, "reserve"), a("B", 4, "performer", "dropped"), a("B", 1)], ["A", "B", "C"]);
    expect(p.load.get("A")).toEqual({ points: 5, duties: 2 });
    expect(p.load.get("B")).toEqual({ points: 1, duties: 1 });
    // C was in the cycle with nothing; D was not in it at all
    expect(prevMean(p, ["A", "B", "C", "D"])).toEqual({ mean: 2, n: 3 });
    expect(prevMean(p, ["D"])).toBeNull();
  });
});
