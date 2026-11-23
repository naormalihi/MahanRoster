import { describe, expect, it } from "vitest";
import type { InputCycle, MyRequests } from "../me";
import { blocksInMonth, closedNotice, requestItems } from "../requestList";

const mine: MyRequests = {
  exemptions: [
    { id: "e1", type: "קפ\"ס", start_date: "2026-12-01", end_date: "2027-05-31", status: "pending", is_urgent: false, mine: true, decision_reason: null },
    { id: "e2", type: "אחר", start_date: "2026-01-01", end_date: "2026-02-01", status: "approved", is_urgent: false, mine: false, decision_reason: "x" },
  ],
  blocks: [
    { id: "b1", day: "2026-11-25", mine: true, open: true },
    { id: "b2", day: "2026-11-28", mine: false, open: true },
  ],
  absences: [{ id: "a1", type: "חופשה", starts_at: "2026-11-30T22:00:00Z", ends_at: "2026-12-02T22:00:00Z", mine: true, open: false }],
};

describe("requestItems", () => {
  it("one list, coming first by date; passed ones apart", () => {
    const { current, past } = requestItems(mine, "2026-11-20");
    expect(current.map((r) => r.key)).toEqual(["bb1", "bb2", "aa1", "ee1"]);
    expect(past.map((r) => r.key)).toEqual(["ee2"]);
  });
  it("what the soldier may cancel", () => {
    const { current } = requestItems(mine, "2026-11-20");
    const by = new Map(current.map((r) => [r.key, r]));
    expect(by.get("ee1")!.cancellable).toBe(true);
    expect(by.get("bb2")!.cancellable).toBe(false); // אחראי השיבוצים entered it
    expect(by.get("bb2")!.byStaff).toBe(true);
    expect(by.get("aa1")!.cancellable).toBe(false); // the deadline passed
    expect(by.get("aa1")!.from).toBe("2026-12-01");
    expect(by.get("aa1")!.to).toBe("2026-12-02");
  });
  it("the monthly block quota counts his own only", () => {
    expect(blocksInMonth(mine, "2026-11")).toBe(1);
    expect(blocksInMonth(mine, "2026-12")).toBe(0);
  });
});

describe("closedNotice", () => {
  const c = (id: string, start: string, end: string, open: boolean): InputCycle => ({ id, name: id, start_date: start, end_date: end, deadline: null, open });
  it("the closed cycle of the coming days, and the next open one", () => {
    const r = closedNotice([c("b", "2027-06-01", "2027-11-30", true), c("a", "2026-12-01", "2027-05-31", false)], "2026-11-20");
    expect(r?.closed.id).toBe("a");
    expect(r?.next?.id).toBe("b");
  });
  it("nothing when all are open", () => {
    expect(closedNotice([c("a", "2026-12-01", "2027-05-31", true)], "2026-11-20")).toBeNull();
  });
});
