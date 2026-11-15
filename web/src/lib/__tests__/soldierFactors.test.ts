import { describe, expect, it } from "vitest";
import type { Exemption } from "../cycles";
import { soldierFactors, type FactorInput } from "../soldierFactors";
import type { SoldierDetail } from "../soldiers";

const soldier = (o: Partial<SoldierDetail> = {}): SoldierDetail => ({
  id: "s1", full_name: "א", service_type: "mandatory", gender: null, gaf_id: "g", gaf_name: "ענן", rank_name: "סמל",
  appointment_rank_id: null, appointment_rank_until: null, enlistment_date: "2025-01-01", release_date: "2028-01-01",
  career_start_date: null, range_valid_until: "2028-01-01", is_shachar: false, shachar_start_date: null, parent_status: false,
  parent_override: null, parent_override_reason: null, parent_override_until: null, second_role_signed_at: null,
  home_nightly: false, home_nightly_override: null, home_nightly_override_reason: null, home_nightly_override_until: null,
  tash_level: null, is_active: true, load_roles: [], ...o,
});
const ex = (o: Partial<Exemption>): Exemption => ({
  id: "e", soldier_id: "s1", exemption_type_id: "full", kind: "full", start_date: "2027-03-01", end_date: "2027-04-15",
  excluded_task_type_ids: null, restricted_hours: null, is_urgent: false, status: "approved", source: "coordinator",
  proof_checked_at: null, decided_at: null, decision_reason: null, received_via: null, received_at: null, ...o,
} as Exemption);
const base = (o: Partial<FactorInput> = {}): FactorInput => ({
  soldier: soldier(), cycle: { start: "2027-01-01", end: "2027-06-30" }, creditDays: 0, credit: 0, exemptions: [],
  exemptionTypes: [{ id: "full", name: "פטור מלא" } as never, { id: "t7", name: "ת\"ש 7", home_nightly: true } as never],
  absences: [], absenceTypes: [], taskName: (id) => id, holiday: null, today: "2026-11-15", ...o,
});
const titles = (o: Partial<FactorInput>) => soldierFactors(base(o)).map((f) => f.title);

describe("soldier factors", () => {
  it("lists nothing for an ordinary soldier", () => {
    expect(soldierFactors(base())).toEqual([]);
  });

  it("shows time away with its credit", () => {
    const [f] = soldierFactors(base({ exemptions: [ex({})], creditDays: 46, credit: 6 }));
    expect(f.title).toBe("היעדרות ופטור במחזור");
    expect(f.tag?.text).toBe("46 ימים");
    expect(f.effect).toContain("פטור מלא 1.3–15.4");
    expect(f.effect).toContain("זיכוי של 6.0");
  });

  it("tells ת״ש 7 by its source and a הת״ש level by its nights", () => {
    expect(titles({ soldier: soldier({ tash_level: 3 }) })).toEqual(['הת"ש 3']);
    expect(soldierFactors(base({ soldier: soldier({ tash_level: 3 }) }))[0].effect).toContain("עד 4 לילות בבסיס");
    expect(titles({ soldier: soldier({ home_nightly: true }) })).toEqual(['ת"ש 7 – מקובץ כוח האדם']);
    expect(titles({ exemptions: [ex({ exemption_type_id: "t7", kind: "partial" })] })).toEqual(['ת"ש 7 – לפי פטור 1.3–15.4']);
  });

  it("shows relief, parent, שח״ר, range, holiday duty and service dates", () => {
    const t = titles({
      soldier: soldier({
        load_roles: [{ load_role_id: "r", name: "ראש צוות", factor: 0.5, valid_from: "2026-01-01", valid_to: null }],
        parent_status: true, is_shachar: true, range_valid_until: "2027-03-12", release_date: "2027-05-15",
      }),
      holiday: { day: "2027-04-21", task_name: "שמירות חובה" },
    });
    expect(t).toEqual(["הקלה: ראש צוות ×0.5", "הורה", 'שח"ר', "מטווח בתוקף עד 12.3", "תורנות חג", "שחרור 15.5"]);
    expect(soldierFactors(base({ soldier: soldier({ load_roles: [{ load_role_id: "r", name: "ראש צוות", factor: 0.5, valid_from: "2026-01-01", valid_to: null }] }) }))[0].effect).toContain("50%");
  });
  it("a range never entered is assumed valid; an entered date that passed blocks", () => {
    const missing = soldierFactors(base({ soldier: soldier({ range_valid_until: null }) }));
    expect(missing.some((f) => f.icon === "range")).toBe(false);
    const old = soldierFactors(base({ soldier: soldier({ range_valid_until: "2026-12-01" }) }));
    expect(old.find((f) => f.icon === "range")?.tag?.text).toBe("חוסם");
  });
  it("a new soldier in his training period, with his opening score", () => {
    const f = soldierFactors(base({ soldier: soldier({ unit_join_date: "2027-01-01", opening_score: 10.86 }), graceDays: 90 }));
    const n = f.find((x) => x.icon === "newcomer");
    expect(n?.title).toBe("חייל חדש – בהכשרה עד 31.3");
    expect(n?.effect).toContain("ניקוד פתיחה 10.9");
    // the training period ended before the cycle: nothing to show
    expect(soldierFactors(base({ soldier: soldier({ unit_join_date: "2026-01-01" }), graceDays: 90 })).some((x) => x.icon === "newcomer")).toBe(false);
    expect(soldierFactors(base({ soldier: soldier({ unit_join_date: "2027-01-01" }), graceDays: 0 })).some((x) => x.icon === "newcomer")).toBe(false);
  });
});
