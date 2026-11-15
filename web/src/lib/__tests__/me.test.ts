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
