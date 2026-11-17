import { describe, expect, it } from "vitest";
import { markTourSeen, TOUR, tourKind, tourSeen } from "../tour";
import type { Me } from "../api";

const me = (roles: Me["roles"]): Me => ({ userId: "u1", username: "x", roles, mustChangePassword: false });

describe("tour", () => {
  it("picks the tour by role", () => {
    expect(tourKind(null)).toBeNull();
    expect(tourKind(me(["soldier"]))).toBe("soldier");
    expect(tourKind(me(["coordinator"]))).toBe("staff");
    expect(tourKind(me(["deputy", "soldier"]))).toBe("staff");
    expect(tourKind(me(["gaf_commander", "soldier"]))).toBe("reader");
    expect(tourKind(me(["unit_commander"]))).toBe("reader");
  });

  it("has three steps ending with the install step", () => {
    for (const steps of Object.values(TOUR)) {
      expect(steps).toHaveLength(3);
      expect(steps[2].install).toBe(true);
    }
  });

  it("remembers per user and survives broken storage", () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(tourSeen("a", store)).toBe(false);
    markTourSeen("a", store);
    expect(tourSeen("a", store)).toBe(true);
    expect(tourSeen("b", store)).toBe(false);
    const broken = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
    expect(tourSeen("a", broken)).toBe(false);
    expect(() => markTourSeen("a", broken)).not.toThrow();
  });
});
