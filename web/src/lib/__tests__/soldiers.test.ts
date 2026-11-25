import { describe, expect, it } from "vitest";
import { activeLoadRole, careerSwitch, effectiveParent, effectiveService, rangeState } from "../soldiers";

const T = "2026-11-07";

describe("soldier helpers", () => {
  it("range state", () => {
    expect(rangeState(null, T)).toBe("missing");
    expect(rangeState("2026-11-06", T)).toBe("expired");
    expect(rangeState("2026-12-01", T)).toBe("expiring");
    expect(rangeState("2027-06-30", T)).toBe("valid");
  });
  it("service follows the career start date", () => {
    expect(effectiveService({ service_type: "mandatory", career_start_date: "2026-01-01" }, T)).toBe("career");
    expect(effectiveService({ service_type: "career", career_start_date: "2027-01-01" }, T)).toBe("mandatory");
    expect(effectiveService({ service_type: "career", career_start_date: null }, T)).toBe("career");
  });
  it("manual parent override wins until it ends", () => {
    expect(effectiveParent({ parent_status: false, parent_override: true, parent_override_until: null }, T)).toBe(true);
    expect(effectiveParent({ parent_status: true, parent_override: false, parent_override_until: "2026-12-01" }, T)).toBe(false);
    expect(effectiveParent({ parent_status: true, parent_override: false, parent_override_until: "2026-01-01" }, T)).toBe(true);
  });
  it("lowest active load factor", () => {
    const r = (factor: number, valid_from: string, valid_to: string | null = null) => ({ load_role_id: "x", name: "n" + factor, factor, valid_from, valid_to });
    expect(activeLoadRole({ load_roles: [r(0.7, "2026-01-01"), r(0.5, "2026-01-01"), r(0.3, "2027-01-01")] }, T)?.factor).toBe(0.5);
    expect(activeLoadRole({ load_roles: [r(0.5, "2025-01-01", "2026-01-01")] }, T)).toBeNull();
  });
});

describe("careerSwitch", () => {
  const F = "2027-01-01", T = "2027-01-10"; // 10 days
  it("outside the cycle – none", () => {
    expect(careerSwitch(null, F, T)).toBeNull();
    expect(careerSwitch("2027-01-01", F, T)).toBeNull(); // career from the first day
    expect(careerSwitch("2027-01-11", F, T)).toBeNull();
  });
  it("mostly career – off before the date", () => {
    expect(careerSwitch("2027-01-04", F, T)).toEqual({ service: "career", offFrom: F, offTo: "2027-01-03" });
  });
  it("mostly mandatory, and a tie – off from the date", () => {
    expect(careerSwitch("2027-01-08", F, T)).toEqual({ service: "mandatory", offFrom: "2027-01-08", offTo: null });
    expect(careerSwitch("2027-01-06", F, T)).toEqual({ service: "mandatory", offFrom: "2027-01-06", offTo: null }); // 5 and 5
  });
});
