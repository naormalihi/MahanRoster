import { expect, test } from "vitest";
import { weekDays } from "../weekDays";

test("weekDays counts each coming day's duties and the unstaffed ones", () => {
  const now = new Date("2026-11-28T15:00:00Z"); // Saturday 17:00 in Israel
  const rows = [
    { starts_at: "2026-11-28T18:00:00Z", performers: ["a"] },
    { starts_at: "2026-11-29T06:00:00Z", performers: [] },
    { starts_at: "2026-11-29T21:30:00Z", performers: ["b"] }, // 23:30 Israel – still the 29th
    { starts_at: "2026-11-29T22:30:00Z", performers: ["c"] }, // 00:30 Israel – the 30th
    { starts_at: "2026-12-05T08:00:00Z", performers: [] }, // the eighth day – out
  ];
  const w = weekDays(rows, now);
  expect(w.map((d) => d.key)).toEqual(["2026-11-28", "2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"]);
  expect(w[0]).toMatchObject({ duties: 1, unstaffed: 0 });
  expect(w[1]).toMatchObject({ duties: 2, unstaffed: 1 });
  expect(w[2]).toMatchObject({ duties: 1, unstaffed: 0 });
  expect(w.reduce((n, d) => n + d.duties, 0)).toBe(4);
});
