import { describe, expect, it } from "vitest";
import { autoStatus, stageStates, type Cycle, type StageFacts } from "./cycles";

const now = new Date("2026-11-20T10:00:00Z");
const base: Cycle = {
  id: "c", name: "דצמבר", start_date: "2026-12-01", end_date: "2026-12-31",
  exemption_deadline: "2026-11-15T20:00:00Z", status: "draft", published_at: null, potential_computed_at: null,
};
const facts: StageFacts = { rosterAt: "2026-11-10T08:00:00Z", pending: 0, slots: 0, job: null };

describe("automatic cycle stages", () => {
  it("advances by what was done", () => {
    expect(autoStatus(base, { ...facts, rosterAt: null }, now, "2026-11-20")).toBe("loading");
    expect(autoStatus({ ...base, exemption_deadline: "2026-11-25T20:00:00Z" }, facts, now, "2026-11-20")).toBe("collecting");
    expect(autoStatus(base, { ...facts, pending: 2 }, now, "2026-11-20")).toBe("approving");
    expect(autoStatus(base, facts, now, "2026-11-20")).toBe("potential");
    expect(autoStatus({ ...base, potential_computed_at: "2026-11-18T08:00:00Z" }, facts, now, "2026-11-20")).toBe("slots");
  });

  it("leaves a run alone and closes a published cycle after its last day", () => {
    expect(autoStatus({ ...base, status: "review" }, { ...facts, rosterAt: null }, now, "2026-11-20")).toBe("review");
    expect(autoStatus({ ...base, status: "published" }, facts, now, "2027-01-01")).toBe("closed");
    expect(autoStatus({ ...base, status: "published" }, facts, now, "2026-12-31")).toBe("published");
  });

  it("marks each stage", () => {
    const s = Object.fromEntries(stageStates(base, { ...facts, pending: 3, slots: 40 }, now).map((x) => [x.stage, x]));
    expect(s.loading.tone).toBe("done");
    expect(s.collecting.note).toBe("נסגר 15/11");
    expect(s.approving).toMatchObject({ tone: "warn", note: "3 ממתינים" });
    expect(s.slots.note).toBe("40 משימות");
    expect(s.scheduling.tone).toBe("todo");
  });
});

describe("constraints deadline", () => {
  it("is the end of the chosen local day", async () => {
    const { endOfDay, deadlineDay } = await import("./cycles");
    expect(endOfDay("2026-10-22")).toBe("2026-10-22T23:59:59+03:00");
    expect(endOfDay("2027-01-10")).toBe("2027-01-10T23:59:59+02:00");
    expect(deadlineDay(endOfDay("2027-01-10"))).toBe("2027-01-10");
  });
});
