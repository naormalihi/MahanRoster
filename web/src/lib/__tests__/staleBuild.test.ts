import { describe, expect, it } from "vitest";
import { isStaleBuild } from "../staleBuild";

describe("stale build", () => {
  it("recognizes a module of an older version that is gone", () => {
    expect(isStaleBuild("Failed to fetch dynamically imported module: https://x.workers.dev/assets/supabaseApi-zNDWip2L.js")).toBe(true);
    expect(isStaleBuild("Importing a module script failed.")).toBe(true);
    expect(isStaleBuild("permission denied")).toBe(false);
    expect(isStaleBuild(undefined)).toBe(false);
  });
});
