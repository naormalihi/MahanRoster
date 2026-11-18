import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone } from "../phone";

describe("phone", () => {
  it("accepts the common ways of writing a mobile number", () => {
    for (const v of ["050-1234567", "0501234567", "050 123 4567", "+972 50-123-4567", "00972501234567", "972501234567", 501234567, "(050) 123-4567"])
      expect(normalizePhone(v)).toBe("972501234567");
  });

  it("empty is null, anything else is invalid", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone("  ")).toBeNull();
    for (const v of ["03-1234567", "05012345", "05012345678", "abc", "050-123456x", "+1 555 123 4567"]) expect(normalizePhone(v)).toBe("invalid");
  });

  it("shows a stored number the Israeli way", () => {
    expect(formatPhone("972501234567")).toBe("050-123-4567");
    expect(formatPhone(null)).toBe("");
  });
});
