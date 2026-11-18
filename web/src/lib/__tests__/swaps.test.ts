import { describe, expect, it } from "vitest";
import { canAskSwap, swapStatusLabel } from "../swaps";

describe("swaps", () => {
  const now = Date.parse("2027-01-10T08:00:00Z");
  it("offers a swap on a live duty at least 24 hours ahead", () => {
    expect(canAskSwap({ status: "assigned", starts_at: "2027-01-11T08:00:00Z" }, now)).toBe(true);
    expect(canAskSwap({ status: "reserve_idle", starts_at: "2027-01-12T08:00:00Z" }, now)).toBe(true);
    expect(canAskSwap({ status: "assigned", starts_at: "2027-01-11T07:59:00Z" }, now)).toBe(false);
    expect(canAskSwap({ status: "reserve_activated", starts_at: "2027-01-15T08:00:00Z" }, now)).toBe(false);
  });
  it("labels a request from each side", () => {
    expect(swapStatusLabel({ status: "pending_peer", expired: false, mine: true }).text).toBe("ממתין לתשובה");
    expect(swapStatusLabel({ status: "pending_peer", expired: false, mine: false }).text).toBe("מחכה לך");
    expect(swapStatusLabel({ status: "pending_peer", expired: true, mine: false }).text).toBe("פג תוקף");
    expect(swapStatusLabel({ status: "approved", expired: false, mine: true }).tone).toBe("success");
  });
});
