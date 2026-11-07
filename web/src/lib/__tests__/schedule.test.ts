import { describe, expect, it } from "vitest";
import { elapsed, looksStuck, mmss, topReasons, type ScheduleJob } from "../schedule";

describe("scheduling runs", () => {
  const job = (o: Partial<ScheduleJob>): ScheduleJob => ({
    id: "j", status: "queued", kind: "full", progress: 0, created_at: "2026-11-07T10:00:00Z", started_at: null, finished_at: null,
    error: null, params: {}, result_status: null, wall_time: null, unfilled: null, warnings: null, pools: null, ...o,
  });
  const at = (s: string) => Date.parse(s);
  it("elapsed time", () => {
    expect(elapsed("2026-11-07T10:00:00Z", at("2026-11-07T10:02:05Z"))).toBe(125);
    expect(mmss(125)).toBe("2:05");
  });
  it("a queued job is stuck after two minutes", () => {
    expect(looksStuck(job({}), at("2026-11-07T10:01:00Z"))).toBe(false);
    expect(looksStuck(job({}), at("2026-11-07T10:03:00Z"))).toBe(true);
    expect(looksStuck(job({ status: "running" }), at("2026-11-07T10:30:00Z"))).toBe(false);
  });
  it("lists the main reasons", () => {
    expect(topReasons({ rank: 3, busy: 10, absence: 1, gender: 5 }, { rank: "דרגה", busy: "עסוק" }, 2)).toBe("עסוק (10) · gender (5)");
  });
});
