import { describe, expect, it } from "vitest";
import { ago, isIos, keyBytes } from "../notifications";

describe("notifications", () => {
  it("turns the VAPID key into bytes", () => {
    // 65 bytes of an uncompressed P-256 point start with 0x04
    const key = "BOr" + "A".repeat(84);
    const b = keyBytes(key);
    expect(b.length).toBe(65);
    expect(b[0]).toBe(0x04);
  });
  it("says how long ago", () => {
    const now = Date.parse("2027-01-10T12:00:00Z");
    expect(ago("2027-01-10T11:59:40Z", now)).toBe("עכשיו");
    expect(ago("2027-01-10T11:30:00Z", now)).toBe("לפני 30 דק׳");
    expect(ago("2027-01-10T08:00:00Z", now)).toBe("לפני 4 שע׳");
    expect(ago("2027-01-05T08:00:00Z", now)).toBe("05/01");
  });
  it("knows an iPhone", () => {
    expect(isIos("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(true);
    expect(isIos("Mozilla/5.0 (Linux; Android 14)")).toBe(false);
  });
});

describe("dashboard", () => {
  it("compares gafs by points per soldier", async () => {
    const { perSoldier } = await import("../dashboard");
    expect(perSoldier({ soldiers: 4, points: 10 })).toBe(2.5);
    expect(perSoldier({ soldiers: 0, points: 0 })).toBe(0);
  });
});
