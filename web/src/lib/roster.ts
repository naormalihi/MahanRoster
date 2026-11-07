/**
 * Roster (כוח אדם) Excel import: header detection, row parsing and the diff
 * against the soldiers already in the system. Pure functions – easy to test.
 */

import { normalizePersonalNumber } from "./hmac";

export type FieldKey =
  | "personalNumber"
  | "fullName"
  | "firstName"
  | "lastName"
  | "serviceType"
  | "careerStartDate"
  | "gaf"
  | "framework"
  | "rank"
  | "gender"
  | "enlistmentDate"
  | "releaseDate"
  | "rangeValidUntil"
  | "parent"
  | "homeNightly";

export const FIELDS: { key: FieldKey; label: string; required: boolean; synonyms: string[] }[] = [
  { key: "personalNumber", label: "מספר אישי", required: true, synonyms: ["מספר אישי", "מ\"א", "מא", "מס' אישי", "מס אישי"] },
  { key: "fullName", label: "שם מלא", required: false, synonyms: ["שם מלא", "שם"] },
  { key: "firstName", label: "שם פרטי", required: false, synonyms: ["שם פרטי"] },
  { key: "lastName", label: "שם משפחה", required: false, synonyms: ["שם משפחה"] },
  { key: "serviceType", label: "סוג שירות", required: false, synonyms: ["סוג שירות", "שירות", "מעמד"] },
  { key: "careerStartDate", label: "תאריך כניסה לקבע", required: false, synonyms: ["תאריך כניסה לקבע", "כניסה לקבע", "תאריך תחילת קבע", "תחילת קבע"] },
  { key: "gaf", label: "גף", required: false, synonyms: ["גף", "מחלקה", "ענף"] },
  { key: "framework", label: "מסגרת", required: false, synonyms: ["מסגרת", "שיוך ארגוני"] },
  { key: "rank", label: "דרגה", required: true, synonyms: ["דרגה", "דרגה מחושבת", "דרגה נוכחית"] },
  { key: "gender", label: "מין", required: false, synonyms: ["מין", "מגדר"] },
  { key: "enlistmentDate", label: "תאריך גיוס", required: false, synonyms: ["תאריך גיוס", "גיוס"] },
  { key: "releaseDate", label: "תאריך שחרור", required: false, synonyms: ["תאריך שחרור", "שחרור", "תש\"ש", "תאריך תום שירות (תש\"ש)", "תאריך תום שירות"] },
  { key: "rangeValidUntil", label: "תוקף מטווח", required: false, synonyms: ["תוקף מטווח", "מטווח"] },
  { key: "parent", label: "משרת הורה", required: false, synonyms: ["משרת הורה", "נמצא במשרת הורה", "הורה"] },
  { key: "homeNightly", label: "ת\"ש 7 (לינה בבית)", required: false, synonyms: ["ת\"ש 7", "תש 7", "ת\"ש", "תש", "תנאי שירות", "לינה בבית"] },
];

export type Mapping = Partial<Record<FieldKey, string>>;

const clean = (s: string) => s.replace(/["'׳״\s]/g, "").toLowerCase();

/** Best guess of which column holds which field, by header name. */
export function detectMapping(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const used = new Set<string>();
  for (const f of FIELDS) {
    const hit = headers.find((h) => !used.has(h) && f.synonyms.some((syn) => clean(h) === clean(syn)));
    if (hit) {
      mapping[f.key] = hit;
      used.add(hit);
    }
  }
  return mapping;
}

export function mappingProblems(m: Mapping): string[] {
  const out: string[] = [];
  for (const f of FIELDS) if (f.required && !m[f.key]) out.push(`חסרה עמודה: ${f.label}`);
  if (!m.fullName && !(m.firstName && m.lastName)) out.push("חסרה עמודת שם (שם מלא, או שם פרטי ושם משפחה)");
  if (!m.gaf && !m.framework) out.push("חסרה עמודת גף (גף, או מסגרת שהגף מופיע בה)");
  return out;
}

/** Ranks that are mandatory service when the file has no service-type column. */
export const MANDATORY_RANKS = new Set(["טוראי", "טור'", "רב\"ט", "סמל", "סמ\"ר"]);

/** "מה"ן - מלמסים/גף ענן/צוות DevOps - מלמסים" → "גף ענן" */
export function gafFromFramework(framework: string): string | null {
  const part = framework.split("/").map((p) => p.trim()).find((p) => /^גף[\s]/.test(p));
  return part ? part.replace(/\s+-\s+.*$/, "").trim() : null;
}

export interface RosterRow {
  line: number;
  personalNumber: string;
  fullName: string;
  serviceType: "mandatory" | "career";
  gaf: string;
  rank: string;
  gender: "male" | "female" | null;
  enlistmentDate: string | null;
  releaseDate: string | null;
  careerStartDate: string | null;
  rangeValidUntil: string | null;
  parent: boolean;
  /** ת"ש 7; null when the file has no such column (the stored value is kept) */
  homeNightly: boolean | null;
}

export interface ParseResult {
  rows: RosterRow[];
  errors: { line: number; message: string }[];
}

/**
 * Excel cells are read without cellDates: a date cell arrives as its serial number (days since
 * 1899-12-30) and is converted exactly. (With cellDates, SheetJS builds the Date in the browser's
 * zone with a historical offset – in Israel 23:59:20 of the day before.)
 */
export function toIsoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    if (!(v > 1 && v < 2958466)) return "invalid";
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000);
    return dt.toISOString().slice(0, 10);
  }
  if (v instanceof Date && !isNaN(v.getTime())) {
    // a Date from elsewhere: its local calendar day, rounded to the nearest midnight
    const r = new Date(v.getTime() + 12 * 3_600_000);
    r.setHours(0, 0, 0, 0);
    const y = r.getFullYear(), m = r.getMonth() + 1, d = r.getDate();
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  let y: number, mo: number, d: number;
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/); // 31/12/2027 (day first, as in Israel)
  if (m) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return "invalid";
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return "invalid";
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function service(v: unknown): "mandatory" | "career" | null {
  const s = clean(String(v ?? ""));
  if (["חובה", "סדיר", "mandatory", "חובה/סדיר"].includes(s)) return "mandatory";
  if (["קבע", "career", "שירותקבע", "קבע/אזרח"].includes(s)) return "career";
  return null;
}

function gender(v: unknown): "male" | "female" | null {
  const s = clean(String(v ?? ""));
  if (["ז", "זכר", "male", "m"].includes(s)) return "male";
  if (["נ", "נקבה", "female", "f"].includes(s)) return "female";
  return null;
}

const truthy = (v: unknown) => ["כן", "v", "1", "true", "x", "✓", "yes", "y"].includes(clean(String(v ?? "")));

/**
 * Service type, by the first source the file has:
 *   1. a service-type column;
 *   2. a career start date column – career from that date on, mandatory before it or when empty;
 *   3. the rank – טוראי to סמ"ר mandatory, everyone else career.
 */
export function serviceOf(
  m: Mapping,
  serviceCell: unknown,
  careerStart: string | null,
  rank: string,
  today = new Date().toISOString().slice(0, 10),
): "mandatory" | "career" | null {
  if (m.serviceType) return service(serviceCell);
  if (m.careerStartDate) return careerStart && careerStart !== "invalid" && careerStart <= today ? "career" : "mandatory";
  return MANDATORY_RANKS.has(rank) ? "mandatory" : "career";
}

/** Parse sheet rows (objects keyed by header) with a column mapping. */
export function parseRows(records: Record<string, unknown>[], m: Mapping): ParseResult {
  const rows: RosterRow[] = [];
  const errors: ParseResult["errors"] = [];
  const seen = new Map<string, number>();
  records.forEach((r, i) => {
    const line = i + 2; // header is line 1
    const get = (k: FieldKey) => (m[k] ? r[m[k] as string] : undefined);
    const pn = normalizePersonalNumber(get("personalNumber"));
    if (!pn) {
      if (Object.values(r).some((v) => String(v ?? "").trim() !== "")) errors.push({ line, message: "מספר אישי חסר או לא תקין" });
      return;
    }
    if (seen.has(pn)) {
      errors.push({ line, message: `מספר אישי כפול (גם בשורה ${seen.get(pn)})` });
      return;
    }
    seen.set(pn, line);
    const name = String(get("fullName") ?? `${get("firstName") ?? ""} ${get("lastName") ?? ""}`).trim().replace(/\s+/g, " ");
    const rankName = String(get("rank") ?? "").trim();
    const careerStart = toIsoDate(get("careerStartDate"));
    const svc = serviceOf(m, get("serviceType"), careerStart, rankName);
    // a "גף" column that actually holds the full framework path is read like the framework column
    const rawGaf = m.gaf ? String(get("gaf") ?? "").trim() : "";
    const gafName = m.gaf
      ? rawGaf.includes("/") ? gafFromFramework(rawGaf) ?? rawGaf : rawGaf
      : gafFromFramework(String(get("framework") ?? ""));
    const dates = {
      enlistmentDate: toIsoDate(get("enlistmentDate")),
      releaseDate: toIsoDate(get("releaseDate")),
      rangeValidUntil: toIsoDate(get("rangeValidUntil")),
      careerStartDate: careerStart,
    };
    const problems: string[] = [];
    if (!name) problems.push("שם חסר");
    if (!svc) problems.push(`סוג שירות לא מוכר: "${get("serviceType") ?? ""}"`);
    if (!gafName) problems.push(m.gaf ? "גף חסר" : "לא נמצא גף במסגרת");
    if (!rankName) problems.push("דרגה חסרה");
    for (const [k, v] of Object.entries(dates)) if (v === "invalid") problems.push(`תאריך לא תקין (${FIELDS.find((f) => f.key === k)?.label})`);
    if (problems.length) {
      errors.push({ line, message: problems.join(", ") });
      return;
    }
    rows.push({
      line,
      personalNumber: pn,
      fullName: name,
      serviceType: svc!,
      gaf: gafName!,
      rank: rankName,
      gender: gender(get("gender")),
      enlistmentDate: dates.enlistmentDate,
      releaseDate: dates.releaseDate,
      careerStartDate: dates.careerStartDate,
      rangeValidUntil: dates.rangeValidUntil,
      parent: truthy(get("parent")),
      homeNightly: m.homeNightly ? truthy(get("homeNightly")) || /(^|\D)7(\D|$)/.test(String(get("homeNightly") ?? "")) : null,
    });
  });
  return { rows, errors };
}

// ---------------------------------------------------------------------------
// Diff against the system
// ---------------------------------------------------------------------------

export interface SoldierRecord {
  soldier_key: string;
  full_name: string;
  service_type: "mandatory" | "career";
  gaf_name: string;
  rank_name: string;
  gender: "male" | "female" | null;
  enlistment_date: string | null;
  release_date: string | null;
  career_start_date: string | null;
  range_valid_until: string | null;
  parent_status: boolean;
  home_nightly: boolean | null;
}

export interface ExistingSoldier extends SoldierRecord {
  id: string;
  is_active: boolean;
}

export const RECORD_LABELS: Record<keyof SoldierRecord, string> = {
  soldier_key: "מזהה",
  full_name: "שם",
  service_type: "סוג שירות",
  gaf_name: "גף",
  rank_name: "דרגה",
  gender: "מין",
  enlistment_date: "תאריך גיוס",
  release_date: "תאריך שחרור",
  career_start_date: "כניסה לקבע",
  range_valid_until: "תוקף מטווח",
  parent_status: "משרת הורה",
  home_nightly: "ת\"ש 7",
};

export interface RosterPlan {
  added: SoldierRecord[];
  updated: { id: string; before: ExistingSoldier; after: SoldierRecord; changes: (keyof SoldierRecord)[] }[];
  removed: ExistingSoldier[];
  unchanged: number;
  unknownGafim: string[];
  unknownRanks: string[];
}

export function toRecord(row: RosterRow, key: string): SoldierRecord {
  return {
    soldier_key: key,
    full_name: row.fullName,
    service_type: row.serviceType,
    gaf_name: row.gaf,
    rank_name: row.rank,
    gender: row.gender,
    enlistment_date: row.enlistmentDate,
    release_date: row.releaseDate,
    career_start_date: row.careerStartDate,
    range_valid_until: row.rangeValidUntil,
    parent_status: row.parent,
    home_nightly: row.homeNightly,
  };
}

export function planImport(
  incoming: SoldierRecord[],
  existing: ExistingSoldier[],
  knownGafim: string[],
  knownRanks: string[],
): RosterPlan {
  const byKey = new Map(existing.map((s) => [s.soldier_key, s]));
  const plan: RosterPlan = { added: [], updated: [], removed: [], unchanged: 0, unknownGafim: [], unknownRanks: [] };
  const fields = Object.keys(RECORD_LABELS).filter((k) => k !== "soldier_key") as (keyof SoldierRecord)[];
  for (const rec of incoming) {
    const old = byKey.get(rec.soldier_key);
    if (!old) {
      plan.added.push(rec);
      continue;
    }
    byKey.delete(rec.soldier_key);
    // A field the file leaves empty keeps its value (e.g. a manually entered range date).
    const changes = fields.filter((f) => rec[f] !== null && rec[f] !== old[f]);
    if (changes.length || !old.is_active) plan.updated.push({ id: old.id, before: old, after: rec, changes });
    else plan.unchanged++;
  }
  plan.removed = [...byKey.values()].filter((s) => s.is_active);
  const gafSet = new Set(knownGafim), rankSet = new Set(knownRanks);
  plan.unknownGafim = [...new Set(incoming.map((r) => r.gaf_name).filter((g) => !gafSet.has(g)))].sort();
  plan.unknownRanks = [...new Set(incoming.map((r) => r.rank_name).filter((r) => !rankSet.has(r)))].sort();
  return plan;
}
