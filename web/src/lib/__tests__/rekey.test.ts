import { describe, expect, it } from "vitest";
import { defaultPicks, doublePicks, matchForRekey, normName, rekeyPairs } from "../rekey";
import type { ExistingSoldier, SoldierRecord } from "../roster";

const rec = (key: string, name: string, extra: Partial<SoldierRecord> = {}): SoldierRecord => ({
  soldier_key: key, full_name: name, service_type: "mandatory", gaf_name: "גף א", rank_name: "סמל", gender: "male",
  enlistment_date: "2025-03-01", release_date: null, career_start_date: null, unit_join_date: null, range_valid_until: null, parent_status: false, home_nightly: null, phone: null,
  ...extra,
});
const old = (id: string, name: string, extra: Partial<SoldierRecord> = {}): ExistingSoldier => ({ ...rec("old-" + id, name, extra), id, is_active: true });

describe("changing the unit key", () => {
  it("normalizes names", () => {
    expect(normName("  אבי   כ״ץ ")).toBe('אבי כ"ץ');
  });
  it("matches by name and checks the details", () => {
    const rows = matchForRekey(
      [rec("n1", "דנה לוי"), rec("n2", "יוסי כהן", { gaf_name: "גף ב", rank_name: "סמ\"ר", enlistment_date: "2024-01-01" }), rec("n3", "חדש לגמרי")],
      [old("a", "דנה לוי"), old("b", "יוסי כהן")],
    );
    expect(rows.map((r) => r.sure)).toEqual([true, false, false]); // יוסי: only the gender agrees
    const picks = defaultPicks(rows);
    expect(picks).toEqual({ n1: "a", n2: "b" });
    expect(rekeyPairs(picks)).toContainEqual({ id: "a", key: "n1" });
  });
  it("two namesakes, one promoted: each gets his own", () => {
    const rows = matchForRekey(
      [rec("n1", "ליה קפלן", { gaf_name: "גף פיתוח", rank_name: "סמ\"ר" }), rec("n2", "ליה קפלן", { gaf_name: "גף מערכות", rank_name: "סמ\"ר" })],
      [old("a", "ליה קפלן", { gaf_name: "גף פיתוח", rank_name: "סמל" }), old("b", "ליה קפלן", { gaf_name: "גף מערכות", rank_name: "סמ\"ר" })],
    );
    expect(defaultPicks(rows)).toEqual({ n1: "a", n2: "b" });
  });
  it("leaves namesakes to a person", () => {
    const rows = matchForRekey([rec("n1", "אור דוד"), rec("n2", "אור דוד")], [old("a", "אור דוד"), old("b", "אור דוד", { gaf_name: "גף ב" })]);
    expect(rows.every((r) => !r.sure)).toBe(true);
    const picks = defaultPicks(rows);
    expect(picks).toEqual({}); // both rows prefer "a" – a person decides
    expect(doublePicks({ n1: "a", n2: "a" })).toEqual(["a"]);
  });
});
