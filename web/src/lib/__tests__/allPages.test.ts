import { describe, expect, it } from "vitest";
import { PAGE_SIZE, allPages } from "../supabaseApi";

describe("allPages", () => {
  it("keeps asking until a page comes back short", async () => {
    const total = PAGE_SIZE * 2 + 448; // like potential_daily of a half-year: past one page
    const asked: [number, number][] = [];
    const rows = await allPages<number>(async (from, to) => {
      asked.push([from, to]);
      return { data: Array.from({ length: Math.max(0, Math.min(to + 1, total) - from) }, (_, i) => from + i), error: null };
    });
    expect(rows).toHaveLength(total);
    expect(new Set(rows).size).toBe(total);
    expect(asked).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it("one request when everything fits", async () => {
    let calls = 0;
    const rows = await allPages<number>(async () => (calls++, { data: [1, 2, 3], error: null }));
    expect(rows).toEqual([1, 2, 3]);
    expect(calls).toBe(1);
  });
  it("an error stops it", async () => {
    await expect(allPages(async () => ({ data: null, error: { message: "boom" } }))).rejects.toThrow("boom");
  });
});
