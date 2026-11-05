import { describe, expect, it } from "vitest";
import { normalizePersonalNumber, soldierKey, unitKeyCheck, unitKeyProblems } from "../hmac";

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
  it("normalizes personal numbers", () => {
    expect(normalizePersonalNumber(" 123-4567 ")).toBe("1234567");
    expect(normalizePersonalNumber(1234567)).toBe("1234567");
    expect(normalizePersonalNumber("0123456")).toBe("0123456");
    expect(normalizePersonalNumber("12a4567")).toBeNull();
    expect(normalizePersonalNumber("123")).toBeNull();
    expect(normalizePersonalNumber(null)).toBeNull();
  });
  it("rejects short unit keys", () => {
    expect(unitKeyProblems("short")).not.toBeNull();
    expect(unitKeyProblems("a-long-enough-unit-key")).toBeNull();
  });
});
