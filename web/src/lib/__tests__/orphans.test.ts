import { describe, expect, it } from "vitest";
import { inSomeCycle, orphanRequests } from "../orphans";
import type { Absence, DateBlock, Exemption } from "../cycles";

const cycles = [{ start_date: "2027-01-01", end_date: "2027-06-30" }];
const ex = (id: string, start_date: string, end_date: string, status = "pending") => ({ id, soldier_id: "s", start_date, end_date, status }) as unknown as Exemption;

describe("requests in no cycle", () => {
  it("finds what no cycle covers, from today on", () => {
    const o = orphanRequests(
      [ex("e1", "2026-12-01", "2026-12-31"), ex("e2", "2026-12-20", "2027-01-10"), ex("e3", "2026-12-01", "2026-12-31", "rejected"), ex("e4", "2026-10-01", "2026-10-31")],
      [{ id: "a1", soldier_id: "s", starts_at: "2026-12-26T22:00:00Z", ends_at: "2026-12-31T22:00:00Z", status: "active" } as unknown as Absence],
      [{ id: "b1", soldier_id: "s", day: "2026-12-23", status: "active" } as unknown as DateBlock, { id: "b2", soldier_id: "s", day: "2027-02-01", status: "active" } as unknown as DateBlock],
      cycles,
      "2026-11-16",
    );
    expect(o.map((x) => x.id)).toEqual(["e1", "b1", "a1"]);
    expect(o.find((x) => x.id === "a1")).toMatchObject({ from: "2026-12-27", to: "2026-12-31" });
  });
  it("tells the soldier's form whether a cycle covers the days", () => {
    expect(inSomeCycle("2026-12-23", "", cycles)).toBe(false);
    expect(inSomeCycle("2026-12-30", "2027-01-02", cycles)).toBe(true);
  });
});
