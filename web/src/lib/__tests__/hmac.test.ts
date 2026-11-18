import { describe, expect, it } from "vitest";
import { normalizeIdNumber, soldierKey, unitKeyCheck, unitKeyProblems } from "../hmac";

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
    expect(normalizeIdNumber(" 12345-6782 ")).toBe("123456782");
    expect(normalizeIdNumber(123456782)).toBe("123456782");
    expect(normalizeIdNumber("18")).toBeNull(); // too short
    expect(normalizeIdNumber("00018")).toBe("000000018"); // leading zeros
    expect(normalizeIdNumber("123456789")).toBeNull(); // check digit
    expect(normalizeIdNumber("000000000")).toBeNull();
    expect(normalizeIdNumber("12a456782")).toBeNull();
    expect(normalizeIdNumber(null)).toBeNull();
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
