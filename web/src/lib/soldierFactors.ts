import { addDaysIso, type Absence, type AbsenceType, type Exemption, type ExemptionType } from "./cycles";
import { activeLoadRole, effectiveHomeNightly, effectiveParent, type SoldierDetail } from "./soldiers";

/**
 * What in a soldier's data steers the schedule for him, one line each – for the soldier dialog.
 * Only what applies is listed; the wording says what it does, not just what it is.
 */

export type FactorIcon = "away" | "night" | "relief" | "parent" | "shachar" | "range" | "holiday" | "service" | "newcomer";

export interface Factor {
  icon: FactorIcon;
  title: string;
  tag?: { text: string; tone: "warning" | "info" };
  effect: string;
}

export interface FactorInput {
  soldier: SoldierDetail;
  cycle: { start: string; end: string };
  /** days out of the unit not by choice, and the points credited for them (the last run) */
  creditDays: number;
  credit: number;
  exemptions: Exemption[];
  exemptionTypes: ExemptionType[];
  absences: Absence[];
  absenceTypes: AbsenceType[];
  taskName: (id: string) => string;
  /** his duty on a holiday or its eve, a year back to a year ahead */
  holiday?: { day: string; task_name: string } | null;
  /** the training period of a new soldier, in days (settings) */
  graceDays?: number;
  today: string;
}

/** 15.04 → "15.4" */
export const dm = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${Number(d)}.${Number(m)}`;
};
const span = (a: string, b: string) => (a.slice(0, 10) === b.slice(0, 10) ? dm(a) : `${dm(a)}–${dm(b)}`);
const overlaps = (a: string, b: string, c: { start: string; end: string }) => a.slice(0, 10) <= c.end && b.slice(0, 10) >= c.start;

export function soldierFactors(x: FactorInput): Factor[] {
  const s = x.soldier;
  const out: Factor[] = [];
  const typeOf = new Map(x.exemptionTypes.map((t) => [t.id, t]));
  const absName = new Map(x.absenceTypes.map((t) => [t.id, t.name]));
  const live = x.exemptions.filter((e) => e.soldier_id === s.id && e.status === "approved" && overlaps(e.start_date, e.end_date, x.cycle));
  const tash7Ex = live.filter((e) => typeOf.get(e.exemption_type_id)?.home_nightly);
  const otherEx = live.filter((e) => !typeOf.get(e.exemption_type_id)?.home_nightly);
  const abs = x.absences.filter((a) => a.soldier_id === s.id && a.status === "active" && overlaps(a.starts_at, a.ends_at, x.cycle));

  // away: full exemptions and absences (with the credit), partial exemptions by what they cover
  const away = [
    ...otherEx.filter((e) => e.kind === "full").map((e) => `${typeOf.get(e.exemption_type_id)?.name ?? "פטור"} ${span(e.start_date, e.end_date)}`),
    ...abs.map((a) => `${absName.get(a.absence_type_id) ?? "היעדרות"} ${span(a.starts_at, a.ends_at)}`),
  ];
  if (away.length || x.creditDays > 0) {
    out.push({
      icon: "away",
      title: "היעדרות ופטור במחזור",
      tag: x.creditDays > 0 ? { text: `${x.creditDays} ימים`, tone: "warning" } : undefined,
      effect:
        (away.length ? `${away.join(" · ")} – לא משובץ בימים האלה.` : "ימים מחוץ ליחידה במחזור.") +
        (x.creditDays > 0 ? ` בעבור ${x.creditDays} ימים שלא מבחירה קיבל זיכוי של ${x.credit.toFixed(1)} נקודות (העומס היומי הממוצע בקבוצה).` : ""),
    });
  }
  for (const e of otherEx.filter((e) => e.kind === "partial")) {
    const what = [
      e.restricted_hours ? `בשעות ${e.restricted_hours}` : "",
      e.excluded_task_type_ids?.length ? `מ${e.excluded_task_type_ids.map(x.taskName).join(", ")}` : "",
    ].filter(Boolean);
    out.push({
      icon: "away",
      title: `${typeOf.get(e.exemption_type_id)?.name ?? "פטור חלקי"} ${span(e.start_date, e.end_date)}`,
      tag: { text: "חלקי", tone: "info" },
      effect: `פטור ${what.join(" ") || "חלקי"} – בשאר הזמן והתורנויות משובץ כרגיל.`,
    });
  }

  // nights at home
  const t7From = s.tash_level === 7 ? "זכאות הת\"ש 7" : effectiveHomeNightly(s, x.cycle.start) ? (s.home_nightly_override != null ? "סימון ידני" : "מקובץ כוח האדם") : null;
  if (t7From || tash7Ex.length) {
    const src = t7From ?? `לפי פטור ${tash7Ex.map((e) => span(e.start_date, e.end_date)).join(", ")}`;
    out.push({
      icon: "night",
      title: `ת"ש 7 – ${src}`,
      tag: tash7Ex.length && !t7From ? { text: "חלק מהמחזור", tone: "warning" } : undefined,
      effect: "בבית כל לילה – לא משובץ לתורנויות שכוללות שעות לילה, חוץ מתורנויות שמסומנות \"מתאימה לת\"ש\".",
    });
  } else if (s.tash_level) {
    out.push({
      icon: "night",
      title: `הת"ש ${s.tash_level}`,
      effect: `${s.tash_level} לילות בבית בשבוע – עד ${7 - s.tash_level} לילות בבסיס בשבוע (ראשון–שבת). תורנויות "מתאימה לת"ש" לא נספרות.`,
    });
  }

  // relief role
  const role = activeLoadRole(s, x.cycle.start);
  if (role) {
    out.push({
      icon: "relief",
      title: `הקלה: ${role.name} ×${role.factor}`,
      tag: role.valid_to && role.valid_to < x.cycle.end ? { text: `עד ${dm(role.valid_to)}`, tone: "warning" } : undefined,
      effect: `מקבל בערך ${Math.round(role.factor * 100)}% מהעומס של חייל רגיל – הניקוד שלו מחולק ב-${role.factor}.`,
    });
  }

  if (effectiveParent(s, x.cycle.start)) out.push({ icon: "parent", title: "הורה", effect: "פתוחות לו גם תורנויות מזכות (שמיועדות למשרתי הורה ולבעלי פטור מזכה)." });
  if (s.is_shachar && s.service_type === "mandatory")
    out.push({ icon: "shachar", title: "שח\"ר", effect: "משובץ רק לתורנויות שמסומנות \"גם לשח\"ר\" או \"רק לשח\"ר\"." });

  // new soldier: no duties during his training period
  if (s.unit_join_date && x.graceDays) {
    const last = addDaysIso(s.unit_join_date, x.graceDays - 1);
    if (last >= x.cycle.start) {
      const opening = s.opening_score != null ? ` נכנס עם ניקוד פתיחה ${Number(s.opening_score).toFixed(1)} – ממוצע הקבוצה שלו.` : "";
      out.push({
        icon: "newcomer",
        title: `חייל חדש – בהכשרה עד ${dm(last)}`,
        tag: { text: "חוסם", tone: "warning" },
        effect: `לא משובץ לתורנויות עד ${dm(last)}.${opening}`,
      });
    }
  }

  // weapon range: no date entered = assumed valid; only an entered date can block
  if (!s.range_valid_until) {
    // nothing to show
  } else if (s.range_valid_until < x.cycle.start) {
    out.push({
      icon: "range",
      title: `מטווח פג ב-${dm(s.range_valid_until)}`,
      tag: { text: "חוסם", tone: "warning" },
      effect: "לא משובץ לתורנויות שדורשות נשק.",
    });
  } else if (s.range_valid_until < x.cycle.end) {
    out.push({
      icon: "range",
      title: `מטווח בתוקף עד ${dm(s.range_valid_until)}`,
      tag: { text: "פג במחזור", tone: "warning" },
      effect: `אחרי ${dm(s.range_valid_until)} לא משובץ לתורנויות שדורשות נשק.`,
    });
  }

  if (x.holiday) {
    const done = x.holiday.day <= x.today;
    out.push({
      icon: "holiday",
      title: "תורנות חג",
      tag: { text: done ? "ביצע" : "משובץ", tone: "info" },
      effect: `${x.holiday.task_name}, ${dm(x.holiday.day)} – בתורנות חג נוספת יועדפו אחרים.`,
    });
  }

  // service dates inside the cycle
  if (s.enlistment_date && s.enlistment_date > x.cycle.start && s.enlistment_date <= x.cycle.end)
    out.push({ icon: "service", title: `גיוס ${dm(s.enlistment_date)}`, effect: "לא משובץ לפני תאריך הגיוס." });
  if (s.release_date && s.release_date >= x.cycle.start && s.release_date < x.cycle.end)
    out.push({ icon: "service", title: `שחרור ${dm(s.release_date)}`, effect: "לא משובץ אחרי תאריך השחרור." });
  if (s.career_start_date && s.career_start_date > x.cycle.start && s.career_start_date <= x.cycle.end)
    out.push({ icon: "service", title: `מעבר לקבע ${dm(s.career_start_date)}`, effect: "מהתאריך הזה משובץ ונמדד כמשרת קבע." });

  return out;
}
