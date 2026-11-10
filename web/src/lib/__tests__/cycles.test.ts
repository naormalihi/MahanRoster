import { describe, expect, it } from "vitest";
import {
  absenceDays,
  absenceSpan,
  blockQuotaProblems,
  currentCycle,
  cycleProblems,
  dedupeConstraints,
  exemptionProblems,
  localMidnight,
  planningCycle,
  parseTemplate,
  suggestCycle,
  templateRows,
  type Cycle,
} from "../cycles";

const cyc = (id: string, start_date: string, end_date: string, status: Cycle["status"] = "draft"): Cycle => ({
  id, name: id, start_date, end_date, status, exemption_deadline: null, published_at: null,
});

describe("cycles", () => {
  it("suggests the next half year", () => {
    const s = suggestCycle([], "2026-11-07");
    expect(s.start_date).toBe("2026-12-01");
    expect(s.end_date).toBe("2027-05-31");
    expect(s.exemption_deadline).toBe("2026-10-22T23:59:59+03:00");
    const next = suggestCycle([cyc("a", "2026-12-01", "2027-05-31")], "2026-11-07");
    expect(next.start_date).toBe("2027-06-01");
    expect(next.end_date).toBe("2027-11-30");
    expect(next.name).toBe("יוני–נובמבר 2027");
  });
  it("rejects overlaps and bad dates", () => {
    const others = [cyc("a", "2027-01-01", "2027-06-30")];
    expect(cycleProblems({ name: "x", start_date: "2027-06-01", end_date: "2027-12-31", exemption_deadline: null }, others)).toHaveLength(1);
    expect(cycleProblems({ name: "x", start_date: "2027-06-01", end_date: "2027-12-31", exemption_deadline: null }, others, "a")).toEqual([]);
    expect(cycleProblems({ name: "", start_date: "2027-07-01", end_date: "2027-06-01", exemption_deadline: null }, [])).toHaveLength(2);
  });
  it("finds the current cycle", () => {
    const list = [cyc("old", "2026-06-01", "2026-11-30", "published"), cyc("next", "2026-12-01", "2027-05-31")];
    expect(currentCycle(list, "2026-11-07")?.id).toBe("old");
    expect(currentCycle(list, "2026-12-07")?.id).toBe("next");
    expect(currentCycle([cyc("c", "2025-01-01", "2025-06-30", "closed")], "2026-11-07")?.id).toBe("c");
    expect(planningCycle(list, "2026-11-07")?.id).toBe("next");
    expect(planningCycle([list[0]], "2026-11-07")?.id).toBe("old");
  });
});

describe("local days", () => {
  it("uses Israel's offset, also across DST", () => {
    expect(localMidnight("2027-01-15")).toBe("2027-01-15T00:00:00+02:00");
    expect(localMidnight("2027-07-15")).toBe("2027-07-15T00:00:00+03:00");
  });
  it("round-trips an absence", () => {
    const span = absenceSpan({ from: "2027-03-20", to: "2027-03-31" }); // crosses the DST switch
    expect(absenceDays(span)).toEqual({ from: "2027-03-20", to: "2027-03-31" });
  });
});

describe("constraint checks", () => {
  it("exemption validation", () => {
    const base = { soldier_id: "s", exemption_type_id: "t", kind: "full" as const, start_date: "2027-01-01", end_date: "2027-02-01", excluded_task_type_ids: null, restricted_hours: null, is_urgent: false, received_via: null };
    expect(exemptionProblems(base)).toEqual([]);
    expect(exemptionProblems({ ...base, kind: "partial" })).toHaveLength(1);
    expect(exemptionProblems({ ...base, kind: "partial", restricted_hours: "22:00-06:00" })).toEqual([]);
    expect(exemptionProblems({ ...base, end_date: "2026-12-01" })).toHaveLength(1);
  });
  it("block quota per soldier per month", () => {
    const existing = [{ soldier_id: "a", day: "2027-01-05", status: "active" as const }];
    const p = blockQuotaProblems(
      [
        { soldier_id: "a", day: "2027-01-20" },
        { soldier_id: "a", day: "2027-02-03" },
        { soldier_id: "b", day: "2027-01-01" },
        { soldier_id: "b", day: "2027-01-02" },
      ],
      existing,
      1,
    );
    expect([...p.keys()]).toEqual([0, 3]);
  });
});

describe("gaf template", () => {
  const soldiers = [
    { id: "s1", full_name: "נועה כהן", gaf_name: "גף ב" },
    { id: "s2", full_name: "איתי לוי", gaf_name: "גף א" },
  ];
  const types = [{ id: "t1", name: "חופשה" }, { id: "t2", name: "יציאה לחו\"ל" }];
  const range = { from: "2027-01-01", to: "2027-06-30" };
  it("builds one row per soldier, sorted by gaf", () => {
    const rows = templateRows(soldiers);
    expect(rows).toHaveLength(3);
    expect(rows[1][0]).toBe("s2");
  });
  it("parses blocks and absences, and reports bad rows", () => {
    const rows = [
      [],
      ["s1", "נועה כהן", "גף ב", "15/02/2027", "", "", ""],
      ["s1", "נועה כהן", "גף ב", "", "חופשה", "01/03/2027", "05/03/2027"],
      ["s2", "איתי לוי", "גף א", "", "יציאה לחו\"ל", new Date(2027, 3, 10), ""],
      ["s2", "איתי לוי", "גף א", "", "", "", ""],
      ["zz", "?", "", "01/02/2027", "", "", ""],
      ["s2", "איתי לוי", "גף א", "01/12/2027", "טיול", "01/02/2027", ""],
    ];
    const r = parseTemplate(rows, soldiers, types, range);
    expect(r.blocks.map((b) => b.day)).toEqual(["2027-02-15"]);
    expect(r.absences.map((a) => [a.from, a.to])).toEqual([["2027-03-01", "2027-03-05"], ["2027-04-10", "2027-04-10"]]);
    expect(r.errors.map((e) => e.line)).toEqual([6, 7, 7]);
  });
  it("skips what is already recorded", () => {
    const parsed = parseTemplate([[], ["s1", "", "", "15/02/2027", "חופשה", "01/03/2027", "05/03/2027"]], soldiers, types, range);
    const d = dedupeConstraints(
      parsed,
      [{ soldier_id: "s1", day: "2027-02-15", status: "active" }],
      [{ soldier_id: "s1", absence_type_id: "t1", status: "active", ...absenceSpan({ from: "2027-03-01", to: "2027-03-05" }) }],
    );
    expect(d.skipped).toBe(2);
    expect(d.blocks).toEqual([]);
  });
});
