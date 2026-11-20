import { describe, expect, it } from "vitest";
import { collapseRepeats } from "../dashboard";

describe("collapseRepeats", () => {
  it("the same change in a row on one day shows once, with the count", () => {
    const c = (at: string, name: string) => ({ at, action: "update", entity: "task_types", name, by: "naat" });
    const out = collapseRepeats([c("2026-11-15T10:00:00Z", "מטבח"), c("2026-11-15T09:00:00Z", "מטבח"), c("2026-11-14T09:00:00Z", "מטבח"), c("2026-11-14T08:00:00Z", "שער")]);
    expect(out.map((x) => [x.name, x.times])).toEqual([["מטבח", 2], ["מטבח", 1], ["שער", 1]]);
  });
});
