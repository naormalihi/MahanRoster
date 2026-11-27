import { describe, expect, it } from "vitest";
import { accountLabel, nextCycleInfo, normalizeCode, splitDuties, type InputCycle, type MyDuty } from "../me";

describe("soldier accounts", () => {
  it("says how an account stands", () => {
    const base = { soldier_id: "s", username: null, is_locked: null, invited_at: null, invite_expires_at: null, invite_state: null };
    expect(accountLabel(undefined, "2026-11-15").text).toBe("—");
    expect(accountLabel({ ...base, username: "avi.k", is_locked: false }, "2026-11-15")).toEqual({ text: "avi.k", tone: "success" });
    expect(accountLabel({ ...base, invite_state: "open", invite_expires_at: "2026-12-15T10:00:00Z" }, "2026-11-15")).toEqual({
      text: "הוזמן · לא נשלח · עד 15/12",
      tone: "warning",
    });
    expect(accountLabel({ ...base, invite_state: "open", invite_expires_at: "2026-12-15T10:00:00Z", invite_sent_at: "2026-11-15T09:00:00Z" }, "2026-11-15")).toEqual({
      text: "נשלח · עד 15/12",
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

describe("requests by cycle", () => {
  it("puts each request under the cycles it falls in, and the rest apart", async () => {
    const { requestsByCycle } = await import("../me");
    const cycles = [
      { id: "c1", name: "א", start_date: "2027-01-01", end_date: "2027-06-30", deadline: null, open: true },
      { id: "c2", name: "ב", start_date: "2027-07-01", end_date: "2027-12-31", deadline: null, open: false },
    ];
    const ex = (id: string, start_date: string, end_date: string) => ({ id, type: "t", start_date, end_date, status: "pending" as const, is_urgent: false, mine: true, decision_reason: null });
    const g = requestsByCycle(
      {
        exemptions: [ex("dec", "2026-12-01", "2026-12-31"), ex("across", "2027-06-20", "2027-07-10"), ex("old", "2026-10-01", "2026-10-20")],
        blocks: [{ id: "b", day: "2027-02-03", mine: true, open: true }],
        absences: [{ id: "a", type: "t", starts_at: "2026-12-26T22:00:00Z", ends_at: "2026-12-31T22:00:00Z", mine: true, open: true }],
      },
      cycles,
      "2026-11-16",
    );
    expect(g.map((x) => [x.cycle?.id ?? null, x.exemptions.map((e) => e.id), x.blocks.length, x.absences.length])).toEqual([
      ["c1", ["across"], 1, 0],
      ["c2", ["across"], 0, 0],
      [null, ["dec"], 0, 1],
    ]);
  });
});

describe("requests by cycle – which cycles", () => {
  it("shows the current and the next cycle, and a later one only with something in it", async () => {
    const { requestsByCycle } = await import("../me");
    const c = (id: string, start_date: string, end_date: string) => ({ id, name: id, start_date, end_date, deadline: null, open: true });
    const cycles = [c("now", "2026-06-01", "2026-11-30"), c("next", "2026-12-01", "2027-05-31"), c("later", "2027-06-01", "2027-11-30"), c("far", "2027-12-01", "2028-05-31")];
    const g = requestsByCycle({ exemptions: [], blocks: [{ id: "b", day: "2027-12-10", mine: true, open: true }], absences: [] }, cycles, "2026-11-16");
    expect(g.map((x) => x.cycle?.id)).toEqual(["now", "next", "far"]);
  });
});

describe("המחזור הבא", () => {
  const cy = (id: string, start: string, end: string, o: Partial<InputCycle> = {}): InputCycle => ({
    id, name: id, start_date: start, end_date: end, deadline: null, open: true, published: false, published_at: null, ...o,
  });
  const cycles = [
    cy("now", "2026-06-01", "2026-12-31", { open: false, published: true }),
    cy("next", "2027-01-01", "2027-06-30", { deadline: "2026-12-10T21:00:00Z" }),
    cy("far", "2027-07-01", "2027-12-31"),
  ];
  it("only the one after today's", () => {
    expect(nextCycleInfo(cycles, null, "2026-11-27")?.name).toBe("next");
    expect(nextCycleInfo([cycles[0]], null, "2026-11-27")).toBeNull();
  });
  it("its step: open, being prepared, published", () => {
    expect(nextCycleInfo(cycles, null, "2026-11-27")?.stage).toBe("open");
    expect(nextCycleInfo([cy("n", "2027-01-01", "2027-06-30", { open: false })], null, "2026-11-27")?.stage).toBe("preparing");
    expect(nextCycleInfo([cy("n", "2027-01-01", "2027-06-30", { open: false, published: true })], null, "2026-11-27")?.stage).toBe("published");
  });
  it("his requests for it", () => {
    const req = {
      exemptions: [
        { id: "1", type: "פטור מלא", start_date: "2027-02-01", end_date: "2027-02-10", status: "pending" as const, is_urgent: false, mine: true, decision_reason: null },
        { id: "2", type: "פטור מלא", start_date: "2026-12-20", end_date: "2027-01-05", status: "approved" as const, is_urgent: false, mine: true, decision_reason: null },
        { id: "3", type: "פטור מלא", start_date: "2026-08-01", end_date: "2026-08-05", status: "rejected" as const, is_urgent: false, mine: true, decision_reason: null },
      ],
      blocks: [{ id: "b", day: "2027-03-03", mine: true, open: true }],
      absences: [],
    };
    expect(nextCycleInfo(cycles, req, "2026-11-27")?.mine).toEqual({ pending: 1, approved: 2, rejected: 0 });
  });
});
