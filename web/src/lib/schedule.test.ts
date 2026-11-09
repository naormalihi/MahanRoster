import { describe, expect, it } from "vitest";
import { poolName, poolNames } from "./schedule";

describe("poolName", () => {
  it("names a fairness group by population and categories, never by id", () => {
    const names = poolNames([
      { fairness_group: "career:50cc8c93", fairness_label: "ש.ג, מטבח", balance_population: "career" },
      { fairness_group: "pop:none", fairness_label: "ללא תורנות פתוחה", balance_population: "mandatory" },
    ]);
    expect(poolName(names, "career:50cc8c93")).toBe("קבע · ש.ג, מטבח");
    expect(poolName(names, "mandatory:unknown-id")).toBe("חובה");
    expect(poolName(names, "career")).toBe("קבע");
  });
});
