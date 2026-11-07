import { describe, expect, it } from "vitest";
import { bySlot, loads, poolMeans, rankCandidates, weeksOf, type Candidate, type DraftAssignment } from "../draft";

const a = (id: string, slot_id: string, soldier_id: string, role: "performer" | "reserve", pts = 1, o: Partial<DraftAssignment> = {}): DraftAssignment => ({
  id, slot_id, soldier_id, role, status: "draft", source: "solver", points: pts, normalized_points: pts, weekend_units: 0, explanation: null, manual_reason: null, ...o,
});

describe("draft", () => {
  it("orders candidates: free and eligible by score, then rule-breaking, then in the slot", () => {
    const c = (id: string, pts: number, o: Partial<Candidate> = {}): Candidate => ({ soldier_id: id, reasons: [], conflicts: [], cycle_points: pts, cycle_duties: 0, in_slot: null, ...o });
    const r = rankCandidates([
      c("busy", 1, { conflicts: [{ slot_id: "x", task: "t", role: "performer", starts_at: "", ends_at: "" }] }),
      c("rank", 0, { reasons: ["rank"] }),
      c("high", 9),
      c("low", 2),
      c("here", 0, { in_slot: "performer" }),
    ]);
    expect(r.map((x) => x.soldier_id)).toEqual(["low", "high", "busy", "rank", "here"]);
  });
  it("finds missing roles per slot", () => {
    const v = bySlot([{ id: "k", performers_needed: 2, reserves_needed: 1 }], [a("1", "k", "s1", "performer"), a("2", "k", "s2", "reserve")]);
    expect(v.get("k")).toMatchObject({ missingPerformers: 1, missingReserves: 0 });
  });
  it("sums load per soldier and the pool mean", () => {
    const ls = loads(
      [
        { soldier_id: "s1", balance_population: "mandatory", baseline_score: 2 },
        { soldier_id: "s2", balance_population: "mandatory", baseline_score: 0 },
      ],
      [a("1", "k", "s1", "performer", 7.5, { weekend_units: 2 }), a("2", "k", "s2", "reserve"), a("3", "m", "s2", "performer", 1, { source: "manual" })],
    );
    expect(ls.find((l) => l.soldier_id === "s1")).toMatchObject({ points: 7.5, expected: 9.5, duties: 1, weekends: 2 });
    expect(ls.find((l) => l.soldier_id === "s2")).toMatchObject({ points: 1, reserves: 1, manual: 1 });
    expect(poolMeans(ls).get("mandatory")).toBeCloseTo(5.25);
  });
  it("groups soldiers by the duties open to them", async () => {
    const { byProfile } = await import("../draft");
    const l = (id: string, expected: number) => ({ soldier_id: id, pool: "m", baseline: 0, points: expected, expected, duties: 0, reserves: 0, weekends: 0, manual: 0 });
    const open: Record<string, string[]> = { a: ["שמירות", "רס\"ר"], b: ["רס\"ר", "שמירות"], c: ["רס\"ר"], d: [] };
    const r = byProfile([l("a", 30), l("b", 34), l("c", 10), l("d", 0)], (id) => [...open[id]]);
    expect(r[0]).toEqual({ key: "רס\"ר + שמירות", soldiers: 2, mean: 32, min: 30, max: 34 });
    expect(r.find((x) => x.key === "—")?.soldiers).toBe(1);
  });
  it("weeks start on Sunday", () => {
    expect(weeksOf("2027-01-01", "2027-01-20")).toEqual(["2026-12-27", "2027-01-03", "2027-01-10", "2027-01-17"]);
  });
});
