import { describe, expect, it } from "vitest";
import { APP_VERSION, CHANGELOG } from "../changelog";

describe("version", () => {
  it("the latest changelog entry is the package version", () => {
    // APP_VERSION comes from package.json through vite's define (as in the build)
    expect(APP_VERSION).not.toBe("dev");
    expect(CHANGELOG[0].version).toBe(APP_VERSION);
  });
  it("versions only go up", () => {
    const n = (v: string) => v.split(".").map(Number).reduce((a, b) => a * 1000 + b, 0);
    for (let i = 1; i < CHANGELOG.length; i++) expect(n(CHANGELOG[i - 1].version)).toBeGreaterThan(n(CHANGELOG[i].version));
  });
});
