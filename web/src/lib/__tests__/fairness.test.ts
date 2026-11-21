import { describe, expect, it } from "vitest";
import type { SoldierLoad } from "../draft";
import { fairRows, oneDutyByCategory, shortGroupName, verdicts } from "../fairness";

const L = (id: string, expected: number, pool = "g"): SoldierLoad => ({
  soldier_id: id, pool, baseline: 0, credit: 0, creditDays: 0, points: expected, expected, duties: 1, reserves: 0, weekends: 0, manual: 0,
});

describe("fairness verdict", () => {
  it("compares a soldier with those who can do the same duties, by % of their mean", () => {
    const ls = [L("a", 10), L("b", 10), L("c", 13), L("d", 1), L("e", 0)];
    const prof = (id: string) => (id === "d" ? "ש" : id === "e" ? "" : "מ");
    const rows = fairRows(ls, prof, 20);
    const by = Object.fromEntries(rows.map((r) => [r.soldier_id, r]));
    expect(by.c.ref).toBeCloseTo(11);
    expect(by.c.outlier).toBe(false); // 13 vs 11 → 2 ≤ 20% of 11 = 2.2
    expect(by.d.compared).toBe(false); // alone in his profile
    expect(by.e.compared).toBe(false); // open to no duty
    const v = verdicts(fairRows([...ls, L("f", 16)], prof, 20)).get("g")!;
    expect(v.outliers.map((r) => r.soldier_id)).toEqual(["f"]); // mean 12.25, limit 2.45: f +3.75 stands out, a/b −2.25 do not
  });
  it("a mean near zero does not flag everyone", () => {
    const rows = fairRows([L("a", 0), L("b", 0.4), L("c", 0)], () => "x", 20);
    expect(rows.some((r) => r.outlier)).toBe(false);
  });
  it("short group names", () => {
    expect(shortGroupName("קבע · מפקד שער + מפקד תורן + משימות חיליות + קצין תורן")).toBe("קבע · 4 קטגוריות");
    expect(shortGroupName("קבע · ממלכ\"ת")).toBe("קבע · ממלכ\"ת");
  });
});

describe("why few duties", () => {
  it("sums the reasons over the slots", async () => {
    const { summarizeReasons } = await import("../draft");
    const c = (reasons: string[], conflicts = 0, in_slot: "performer" | null = null) => ({
      soldier_id: "a", reasons, conflicts: Array.from({ length: conflicts }, () => ({ slot_id: "k", task: "x", role: "performer" as const, starts_at: "", ends_at: "" })), cycle_points: 0, cycle_duties: 0, in_slot,
    });
    const out = summarizeReasons([c(["weapon_range"]), c(["weapon_range", "exemption"]), c([], 1), c([]), c([], 0, "performer"), undefined]);
    expect(out[0]).toMatchObject({ reason: "weapon_range", slots: 2 });
    expect(Object.fromEntries(out.map((x) => [x.reason, x.slots]))).toMatchObject({ exemption: 1, busy: 1, free: 1, assigned: 1 });
  });
  it("keeps which slots each reason blocked, and the duty a busy one overlaps", async () => {
    const { summarizeReasons } = await import("../draft");
    const busy = { slot_id: "other", task: "רס\"ר", role: "performer" as const, starts_at: "s", ends_at: "e" };
    const c = (reasons: string[], conflicts: (typeof busy)[] = []) => ({ soldier_id: "a", reasons, conflicts, cycle_points: 0, cycle_duties: 0, in_slot: null });
    const out = summarizeReasons([c(["rank"]), undefined, c(["rank"]), c([], [busy])], ["k1", "k2", "k3", "k4"]);
    expect(out.find((x) => x.reason === "rank")!.items.map((i) => i.slot_id)).toEqual(["k1", "k3"]);
    expect(out.find((x) => x.reason === "busy")!.items).toEqual([{ slot_id: "k4", conflict: busy }]);
  });
  it("within one duty: not a problem, it evens out next cycle", () => {
    // mean 4.5: one soldier did a 9-point duty, the others none yet
    const ls = [L("a", 9), L("b", 3), L("c", 3), L("d", 3)];
    const rows = fairRows(ls, () => "ש", 40, () => 9);
    const by = Object.fromEntries(rows.map((r) => [r.soldier_id, r]));
    expect(by.a.diff).toBeCloseTo(4.5);
    expect(by.a.outlier).toBe(false);
    expect(by.a.small).toBe(true); // beyond ±40% (1.8), within one duty (9)
    const v = verdicts(rows).get("g")!;
    expect(v.outliers).toEqual([]);
    expect(v.small.map((r) => r.soldier_id)).toContain("a");
    // two duties ahead of the rest: a real, cumulative gap
    const far = fairRows([L("a", 21), L("b", 3), L("c", 3), L("d", 3)], () => "ש", 40, () => 9);
    expect(far.find((r) => r.soldier_id === "a")!.outlier).toBe(true);
  });
  it("one duty = the most a duty of his categories carries in the draft", () => {
    const cat: Record<string, string> = { k1: "ש", k2: "ש", k3: "ר" };
    const m = oneDutyByCategory(
      [
        { slot_id: "k1", normalized_points: 9, role: "performer" },
        { slot_id: "k2", normalized_points: 15, role: "performer" },
        { slot_id: "k3", normalized_points: 7, role: "performer" },
        { slot_id: "k3", normalized_points: 30, role: "reserve" },
      ],
      (k) => cat[k],
    );
    expect(m.get("ש")).toBe(15);
    expect(m.get("ר")).toBe(7);
  });
});
