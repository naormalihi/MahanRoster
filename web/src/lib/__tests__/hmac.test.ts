import { describe, expect, it } from "vitest";
import { normalizeEmployeeNumber, soldierKey, unitKeyCheck, unitKeyProblems } from "../hmac";

describe("soldier key", () => {
  it("is HMAC-SHA256 hex (RFC 4231 test case 2)", async () => {
    expect(await soldierKey("Jefe", "what do ya want for nothing?")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });
  it("is stable and depends on the unit key", async () => {
    const a = await soldierKey("unit-key-0123456789", "1234567");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await soldierKey("unit-key-0123456789", "1234567")).toBe(a);
    expect(await soldierKey("unit-key-0123456780", "1234567")).not.toBe(a);
  });
  it("key check differs from any soldier key", async () => {
    const k = "unit-key-0123456789";
    expect(await unitKeyCheck(k)).not.toBe(await soldierKey(k, "1234567"));
  });
  it("normalizes ID numbers with the check digit", () => {
    expect(normalizeEmployeeNumber(" 12345-6782 ")).toBe("123456782");
    expect(normalizeEmployeeNumber(123456789)).toBe("123456789"); // no check digit
    expect(normalizeEmployeeNumber("18")).toBe("18"); // any length
    expect(normalizeEmployeeNumber("00018")).toBe("18"); // leading zeros dropped: Excel drops them too
    expect(normalizeEmployeeNumber(18)).toBe(normalizeEmployeeNumber("0018"));
    expect(normalizeEmployeeNumber("000")).toBeNull();
    expect(normalizeEmployeeNumber("12a456782")).toBeNull(); // digits only
    expect(normalizeEmployeeNumber("")).toBeNull();
    expect(normalizeEmployeeNumber(null)).toBeNull();
  });
  it("rejects short unit keys", () => {
    expect(unitKeyProblems("short")).not.toBeNull();
    expect(unitKeyProblems("a-long-enough-unit-key")).toBeNull();
  });
});

import { usernameToEmail } from "../api";

describe("login name", () => {
  it("maps a username to the synthetic address and keeps a real address", () => {
    expect(usernameToEmail(" Board ")).toBe("board@users.invalid");
    expect(usernameToEmail("Naor.Malihi@gmail.com")).toBe("naor.malihi@gmail.com");
  });
});
