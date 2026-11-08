import { describe, expect, it } from "vitest";
import type { TaskType } from "../catalog";
import { readHistory, resolveHistory, summarizeHistory } from "../history";

const task = (id: string, name: string, o: Partial<TaskType> = {}): TaskType => ({
  id, code: id, name, category_id: "kt", weight: 1, min_rest_hours: 0, service_restriction: "any", requires_weapon: false,
  is_weekend_type: false, shachar_compatible: false, qualifying_duty: false, eligible_populations: [], rank_min_id: null,
  rank_max_id: null, gender: null, default_start_time: "08:00", default_end_time: "08:00", weekday_hours: null, color: null, is_active: true, ...o,
}) as TaskType;
const TASKS = [task("kt", "קצין תורן – חול"), task("kts", "קצין תורן – שבת", { is_weekend_type: true })];

describe("history import", () => {
  it("reads the template, with Excel dates and yes/no columns", () => {
    const r = readHistory([
      ["מספר אישי", "תאריך", "תאריך סיום", "תורנות", "עתודה שהוקפצה", "קנס"],
      ["1234567", 46388, "", "קצין תורן", "", ""], // 2027-01-01 (Friday)
      ["7654321", "05/01/2027", "", "קצין תורן", "כן", "לא"],
      ["12", "05/01/2027", "", "קצין תורן", "", ""],
      ["", "", "", "", "", ""],
    ]);
    expect(r.header).toBe(true);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ line: 2, personalNumber: "1234567", start: "2027-01-01", end: "2027-01-01", reserveActivated: false });
    expect(r.rows[1]).toMatchObject({ start: "2027-01-05", reserveActivated: true, penalty: false });
    expect(r.errors).toEqual([{ line: 4, message: "מספר אישי לא תקין" }]);
  });
  it("finds soldier and duty, switches to the Shabbat type on a weekend, sets the hours", () => {
    const rows = readHistory([
      ["מספר אישי", "תאריך", "תורנות"],
      ["1234567", "01/01/2027", "קצין תורן"],
      ["1234567", "03/01/2027", "שומר ראש"],
      ["9999999", "03/01/2027", "קצין תורן"],
    ]).rows.map((r) => ({ ...r, key: r.personalNumber === "1234567" ? "k1" : "k9" }));
    const out = resolveHistory(rows, { soldierByKey: new Map([["k1", "s1"]]), tasks: TASKS, aliases: [], weekendIsoDays: [5, 6], holidays: new Set() });
    expect(out.drafts).toHaveLength(1);
    expect(out.drafts[0]).toMatchObject({ soldier_id: "s1", task_type_id: "kts", starts_at: "2027-01-01T08:00:00+02:00", ends_at: "2027-01-02T08:00:00+02:00" });
    expect(out.unknownDuties).toEqual(["שומר ראש"]);
    expect(out.errors.map((e) => e.line)).toEqual([3, 4]);
  });
  it("sums per soldier", () => {
    const d = (s: string, p: number, o = {}) => ({ soldier_id: s, task_type_id: "kt", starts_at: "", normalized_points: p, weekend_units: 0, reserve_activated: false, is_penalty: false, ...o });
    expect(summarizeHistory([d("a", 1.5), d("a", 2, { weekend_units: 1 }), d("b", 0, { is_penalty: true })])).toEqual([
      { soldier_id: "a", duties: 2, points: 3.5, weekends: 1, penalties: 0 },
      { soldier_id: "b", duties: 1, points: 0, weekends: 0, penalties: 1 },
    ]);
  });
});
