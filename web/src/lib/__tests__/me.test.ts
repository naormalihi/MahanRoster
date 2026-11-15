import { describe, expect, it } from "vitest";
import { accountLabel, normalizeCode, splitDuties, type MyDuty } from "../me";

describe("soldier accounts", () => {
  it("says how an account stands", () => {
    const base = { soldier_id: "s", username: null, is_locked: null, invited_at: null, invite_expires_at: null, invite_state: null };
    expect(accountLabel(undefined, "2026-11-15").text).toBe("—");
    expect(accountLabel({ ...base, username: "avi.k", is_locked: false }, "2026-11-15")).toEqual({ text: "avi.k", tone: "success" });
    expect(accountLabel({ ...base, invite_state: "open", invite_expires_at: "2026-12-15T10:00:00Z" }, "2026-11-15")).toEqual({
      text: "הוזמן · עד 15/12",
      tone: "info",
    });
    expect(accountLabel({ ...base, invite_state: "open", invite_expires_at: "2026-11-01T10:00:00Z" }, "2026-11-15").text).toBe("הקוד פג");
  });

  it("reads a code however it was typed", () => {
    expect(normalizeCode(" abcde-fgh23 ")).toBe("ABCDEFGH23");
  });

  it("puts the next duties first and the past after", () => {
    const d = (id: string, s: string, e: string) => ({ assignment_id: id, starts_at: s, ends_at: e }) as MyDuty;
    const now = Date.parse("2027-02-01T00:00:00Z");
    const { upcoming, past } = splitDuties(
      [d("a", "2027-01-05T08:00:00Z", "2027-01-06T08:00:00Z"), d("c", "2027-03-01T08:00:00Z", "2027-03-02T08:00:00Z"), d("b", "2027-02-10T08:00:00Z", "2027-02-11T08:00:00Z")],
      now,
    );
    expect(upcoming.map((x) => x.assignment_id)).toEqual(["b", "c"]);
    expect(past.map((x) => x.assignment_id)).toEqual(["a"]);
  });
});

describe("self-entry window", () => {
  const c = (id: string, start: string, end: string, open: boolean) => ({ id, name: id, start_date: start, end_date: end, deadline: null, open });
  it("is closed only inside a cycle past its deadline", async () => {
    const { entryOpen, openCycle } = await import("../me");
    const cycles = [c("a", "2027-01-01", "2027-06-30", false), c("b", "2027-07-01", "2027-12-31", true)];
    expect(entryOpen("2027-03-01", cycles)).toBe(false);
    expect(entryOpen("2027-08-01", cycles)).toBe(true);
    expect(entryOpen("2028-03-01", cycles)).toBe(true); // no cycle yet
    expect(openCycle(cycles)?.id).toBe("b");
  });
});

describe("gaf screen", () => {
  it("counts each soldier's constraints", async () => {
    const { constraintCounts } = await import("../gaf");
    const o = {
      exemptions: [{ soldier_id: "a" }],
      blocks: [{ soldier_id: "a" }, { soldier_id: "b" }],
      absences: [{ soldier_id: "a" }],
    } as unknown as import("../gaf").GafOverview;
    const m = constraintCounts(o);
    expect([m.get("a"), m.get("b"), m.get("c")]).toEqual([3, 1, undefined]);
  });
});
