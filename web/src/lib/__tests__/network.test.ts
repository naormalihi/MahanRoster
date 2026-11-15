import { describe, expect, it } from "vitest";
import { isNetworkError, OFFLINE_TEXT, pollFailures } from "../network";

describe("polling through network drops", () => {
  it("tells a network drop from a real error", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new Error("TypeError: Failed to fetch"))).toBe(true);
    expect(isNetworkError(new Error("permission denied"))).toBe(false);
  });
  it("stays quiet for short drops, speaks after three in a row, resets on success", () => {
    const p = pollFailures();
    const drop = new TypeError("Failed to fetch");
    expect(p.fail(drop)).toBeNull();
    expect(p.fail(drop)).toBeNull();
    expect(p.fail(drop)).toBe(OFFLINE_TEXT);
    p.ok();
    expect(p.fail(drop)).toBeNull();
    expect(p.fail(new Error("boom"))).toBe("boom");
  });
});
