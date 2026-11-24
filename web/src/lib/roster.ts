/**
 * Roster (כוח אדם) Excel import: header detection, row parsing and the diff
 * against the soldiers already in the system. Pure functions – easy to test.
 */

import { frameworkName } from "./gafName";
import { normalizeEmployeeNumber } from "./hmac";
import { normalizePhone } from "./phone";

export type FieldKey =
  | "idNumber"
  | "fullName"
  | "firstName"
  | "lastName"
  | "serviceType"
  | "careerStartDate"
  | "unitJoinDate"
  | "gaf"
  | "framework"
  | "rank"
  | "gender"
  | "enlistmentDate"
  | "releaseDate"
  | "rangeValidUntil"
  | "parent"
  | "homeNightly"
  | "phone";

export const FIELDS: { key: FieldKey; label: string; required: boolean; synonyms: string[] }[] = [
  { key: "idNumber", label: "מספר עובד", required: true, synonyms: ["מספר עובד", "מס' עובד", "מס עובד", "מס. עובד", "מ.ע", "מ\"ע", "ת.ז", "ת\"ז", "תז", "ת.ז.", "תעודת זהות", "מספר זהות", "מס' זהות", "מס זהות"] },
  { key: "fullName", label: "שם מלא", required: false, synonyms: ["שם מלא", "שם"] },
  { key: "firstName", label: "שם פרטי", required: false, synonyms: ["שם פרטי"] },
  { key: "lastName", label: "שם משפחה", required: false, synonyms: ["שם משפחה"] },
  { key: "serviceType", label: "סוג שירות", required: false, synonyms: ["סוג שירות", "שירות", "מעמד"] },
  { key: "unitJoinDate", label: "תאריך קליטה", required: false, synonyms: ["תאריך קליטה", "קליטה", "תאריך קליטה ליחידה", "תאריך כניסה ליחידה", "תאריך הצטרפות"] },
  { key: "careerStartDate", label: "תאריך כניסה לקבע", required: false, synonyms: ["תאריך כניסה לקבע", "כניסה לקבע", "תאריך תחילת קבע", "תחילת קבע"] },
  { key: "gaf", label: "מסגרת", required: false, synonyms: ["גף", "מחלקה", "ענף"] },
  { key: "framework", label: "נתיב מסגרת", required: false, synonyms: ["מסגרת", "שיוך ארגוני"] },
  { key: "rank", label: "דרגה", required: true, synonyms: ["דרגה", "דרגה מחושבת", "דרגה נוכחית"] },
  { key: "gender", label: "מין", required: false, synonyms: ["מין", "מגדר"] },
  { key: "enlistmentDate", label: "תאריך גיוס", required: false, synonyms: ["תאריך גיוס", "גיוס"] },
  { key: "releaseDate", label: "תאריך שחרור", required: false, synonyms: ["תאריך שחרור", "שחרור", "תש\"ש", "תאריך תום שירות (תש\"ש)", "תאריך תום שירות"] },
  { key: "rangeValidUntil", label: "תוקף מטווח", required: false, synonyms: ["תוקף מטווח", "מטווח"] },
  { key: "parent", label: "משרת הורה", required: false, synonyms: ["משרת הורה", "נמצא במשרת הורה", "הורה"] },
  { key: "phone", label: "טלפון נייד", required: false, synonyms: ["טלפון", "נייד", "טלפון נייד", "פלאפון", "מספר טלפון", "מס' טלפון", "מס טלפון", "סלולרי"] },
  { key: "homeNightly", label: "הת\"ש (סוג 3–7)", required: false, synonyms: ["הת\"ש ימי לינה", "ת\"ש ימי לינה", "ימי לינה", "הת\"ש", "סוג הת\"ש", "רמת הת\"ש", "ת\"ש 7", "תש 7", "ת\"ש", "תש", "תנאי שירות", "לינה בבית"] },
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

/** The old identity column: the system no longer takes personal numbers. */
const PERSONAL_NUMBER_HEADERS = ["מספר אישי", "מ\"א", "מא", "מס' אישי", "מס אישי"];

export function mappingProblems(m: Mapping, headers: string[] = []): string[] {
  const out: string[] = [];
  if (!m.idNumber && headers.some((h) => PERSONAL_NUMBER_HEADERS.some((p) => clean(h) === clean(p))))
    out.push("בקובץ יש עמודת מספר אישי – המערכת מזהה עובדים לפי מספר עובד. החלף את העמודה בעמודת מספר עובד");
  for (const f of FIELDS) if (f.required && !m[f.key]) out.push(`חסרה עמודה: ${f.label}`);
  if (!m.fullName && !(m.firstName && m.lastName)) out.push("חסרה עמודת שם (שם מלא, או שם פרטי ושם משפחה)");
  if (!m.gaf && !m.framework) out.push("חסרה עמודת מסגרת (מסגרת, או נתיב מסגרת שהיא מופיעה בו)");
  return out;
}

/** Ranks that are mandatory service when the file has no service-type column (military or neutral names). */
export const MANDATORY_RANKS = new Set(["טוראי", "טור'", "רב\"ט", "סמל", "סמ\"ר", "חובה 1", "חובה 2", "חובה 3", "חובה 4"]);

const rankKey = (s: string) => s.replace(/["'״׳`\s.-]/g, "");

/**
 * The neutral rank name for a rank written in a file: its own name or a military alias
 * ("סמ"ר", "סמ״ר", "סמר" → "חובה 4"). Null when unknown.
 */
export function rankResolver(ranks: { name: string; aliases?: string[] }[]): (text: string) => string | null {
  const map = new Map<string, string>();
  for (const r of ranks) for (const n of [r.name, ...(r.aliases ?? [])]) if (n) map.set(rankKey(n), r.name);
  return (text) => map.get(rankKey(text.trim())) ?? null;
}

/** "מה"ן - מלמסים/מסגרת ענן/צוות DevOps - מלמסים" → "מסגרת ענן" */
export function gafFromFramework(framework: string): string | null {
  const part = framework.split("/").map((p) => p.trim()).find((p) => /^גף[\s]/.test(p));
  return part ? part.replace(/\s+-\s+.*$/, "").trim() : null;
}

export interface RosterRow {
  line: number;
  idNumber: string;
  fullName: string;
  serviceType: "mandatory" | "career";
  gaf: string;
  rank: string;
  gender: "male" | "female" | null;
  enlistmentDate: string | null;
  releaseDate: string | null;
  careerStartDate: string | null;
  /** תאריך קליטה: decides who is new in the unit (grace, opening score); null: none in the file */
  unitJoinDate: string | null;
  rangeValidUntil: string | null;
  parent: boolean;
  /** ת"ש 7 (סוג 7); null when the file has no such column (the stored value is kept) */
  homeNightly: boolean | null;
  /** סוג הת"ש 3–7, 0: none; null when the file has no such column */
  tashLevel: number | null;
  /** 9725XXXXXXXX; null: no number in the file (the stored one stays) */
  phone: string | null;
}

export interface ParseResult {
  rows: RosterRow[];
  errors: { line: number; message: string }[];
  /** rows of frameworks that were not chosen: not loaded, not errors – kept to spot who moved out */
  outside: { line: number; idNumber: string; record: Record<string, unknown> }[];
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
 *   3. the rank – חובה 1–4 (טוראי to סמ"ר) mandatory, everyone else career.
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

/** Parse sheet rows (objects keyed by header) with a column mapping. `keep` = the chosen
 *  frameworks: a row it leaves out is set aside (outside), not parsed and not an error. */
export function parseRows(records: Record<string, unknown>[], m: Mapping, keep?: (r: Record<string, unknown>) => boolean): ParseResult {
  const rows: RosterRow[] = [];
  const errors: ParseResult["errors"] = [];
  const outside: ParseResult["outside"] = [];
  const seen = new Map<string, number>();
  records.forEach((r, i) => {
    const line = i + 2; // header is line 1
    const get = (k: FieldKey) => (m[k] ? r[m[k] as string] : undefined);
    const pn = normalizeEmployeeNumber(get("idNumber"));
    if (keep && !keep(r)) {
      if (pn) outside.push({ line, idNumber: pn, record: r });
      return;
    }
    if (!pn) {
      if (Object.values(r).some((v) => String(v ?? "").trim() !== "")) errors.push({ line, message: "מספר עובד חסר או לא תקין (רק ספרות)" });
      return;
    }
    if (seen.has(pn)) {
      errors.push({ line, message: `מספר עובד כפול (גם בשורה ${seen.get(pn)})` });
      return;
    }
    seen.set(pn, line);
    const name = String(get("fullName") ?? `${get("firstName") ?? ""} ${get("lastName") ?? ""}`).trim().replace(/\s+/g, " ");
    const rankName = String(get("rank") ?? "").trim();
    const careerStart = toIsoDate(get("careerStartDate"));
    const svc = serviceOf(m, get("serviceType"), careerStart, rankName);
    // a "מסגרת" column that actually holds the full framework path is read like the framework column
    const rawGaf = m.gaf ? String(get("gaf") ?? "").trim() : "";
    // stored by its own name: "גף ענן" in the file is the framework "ענן"
    const gafName = frameworkName(
      m.gaf
        ? rawGaf.includes("/") ? gafFromFramework(rawGaf) ?? rawGaf : rawGaf
        : gafFromFramework(String(get("framework") ?? "")),
    );
    const dates = {
      enlistmentDate: toIsoDate(get("enlistmentDate")),
      releaseDate: toIsoDate(get("releaseDate")),
      rangeValidUntil: toIsoDate(get("rangeValidUntil")),
      careerStartDate: careerStart,
      unitJoinDate: toIsoDate(get("unitJoinDate")),
    };
    const problems: string[] = [];
    if (!name) problems.push("שם חסר");
    if (!svc) problems.push(`סוג שירות לא מוכר: "${get("serviceType") ?? ""}"`);
    if (!gafName) problems.push(m.gaf ? "מסגרת חסרה" : "לא נמצאה מסגרת בנתיב המסגרת");
    if (!rankName) problems.push("דרגה חסרה");
    const tash = m.homeNightly ? tashLevel(get("homeNightly")) : null;
    if (tash === "invalid") problems.push(`סוג הת"ש לא מוכר: "${get("homeNightly")}" (3–7)`);
    const phone = m.phone ? normalizePhone(get("phone")) : null;
    if (phone === "invalid") problems.push(`טלפון נייד לא תקין: "${get("phone")}"`);
    for (const [k, v] of Object.entries(dates)) if (v === "invalid") problems.push(`תאריך לא תקין (${FIELDS.find((f) => f.key === k)?.label})`);
    if (problems.length) {
      errors.push({ line, message: problems.join(", ") });
      return;
    }
    rows.push({
      line,
      idNumber: pn,
      fullName: name,
      serviceType: svc!,
      gaf: gafName!,
      rank: rankName,
      gender: gender(get("gender")),
      enlistmentDate: dates.enlistmentDate,
      releaseDate: dates.releaseDate,
      careerStartDate: dates.careerStartDate,
      unitJoinDate: dates.unitJoinDate,
      rangeValidUntil: dates.rangeValidUntil,
      parent: truthy(get("parent")),
      phone: phone as string | null, // "invalid" stopped the row above
      homeNightly: tash === null ? null : tash === 7,
      tashLevel: tash as number | null, // "invalid" stopped the row above
    });
  });
  return { rows, errors, outside };
}

/**
 * The הת"ש cell holds its type – how many nights a week at home (3–7). Empty, 0 or "לא": none.
 * "כן" / V with no number: ת"ש 7, as files used to mark it.
 */
export function tashLevel(v: unknown): number | "invalid" {
  const t = String(v ?? "").trim();
  if (!t || t === "0" || /^(לא|no|false|-|—)$/i.test(t)) return 0;
  const n = t.match(/\d+/);
  if (n) {
    const k = Number(n[0]);
    return k >= 3 && k <= 7 ? k : "invalid";
  }
  return truthy(t) ? 7 : "invalid";
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
  unit_join_date: string | null;
  range_valid_until: string | null;
  parent_status: boolean;
  home_nightly: boolean | null;
  /** סוג הת"ש 3–7, 0: none; null: not in the file (kept) */
  tash_level: number | null;
  phone: string | null;
}

export interface ExistingSoldier extends SoldierRecord {
  id: string;
  is_active: boolean;
}

export const RECORD_LABELS: Record<keyof SoldierRecord, string> = {
  soldier_key: "מזהה",
  full_name: "שם",
  service_type: "סוג שירות",
  gaf_name: "מסגרת",
  rank_name: "דרגה",
  gender: "מין",
  enlistment_date: "תאריך גיוס",
  release_date: "תאריך שחרור",
  career_start_date: "כניסה לקבע",
  unit_join_date: "תאריך קליטה",
  range_valid_until: "תוקף מטווח",
  parent_status: "משרת הורה",
  home_nightly: "ת\"ש 7",
  tash_level: "סוג הת\"ש",
  phone: "טלפון",
};

export interface RosterPlan {
  added: SoldierRecord[];
  updated: { id: string; before: ExistingSoldier; after: SoldierRecord; changes: (keyof SoldierRecord)[] }[];
  removed: ExistingSoldier[];
  /** in the file, but in a framework that was not chosen – stays active unless אחראי השיבוצים marks it */
  movedOut: { soldier: ExistingSoldier; to: string }[];
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
    unit_join_date: row.unitJoinDate,
    range_valid_until: row.rangeValidUntil,
    parent_status: row.parent,
    home_nightly: row.homeNightly,
    tash_level: row.tashLevel,
    phone: row.phone,
  };
}

export function planImport(
  incoming: SoldierRecord[],
  existing: ExistingSoldier[],
  knownGafim: string[],
  knownRanks: string[],
  /** soldier key → the framework (not chosen) the file puts him in */
  outside: Map<string, string> = new Map(),
): RosterPlan {
  const byKey = new Map(existing.map((s) => [s.soldier_key, s]));
  const plan: RosterPlan = { added: [], updated: [], removed: [], movedOut: [], unchanged: 0, unknownGafim: [], unknownRanks: [] };
  const fields = Object.keys(RECORD_LABELS).filter((k) => k !== "soldier_key") as (keyof SoldierRecord)[];
  for (const rec of incoming) {
    const old = byKey.get(rec.soldier_key);
    if (!old) {
      plan.added.push(rec);
      continue;
    }
    byKey.delete(rec.soldier_key);
    // A field the file leaves empty keeps its value (e.g. a manually entered range date).
    const changes = fields.filter((f) => rec[f] !== null && rec[f] !== (f === "tash_level" ? (old.tash_level ?? 0) : old[f]));
    if (changes.length || !old.is_active) plan.updated.push({ id: old.id, before: old, after: rec, changes });
    else plan.unchanged++;
  }
  for (const s of byKey.values()) {
    if (!s.is_active) continue;
    const to = outside.get(s.soldier_key);
    if (to !== undefined) plan.movedOut.push({ soldier: s, to });
    else plan.removed.push(s);
  }
  const gafSet = new Set(knownGafim), rankSet = new Set(knownRanks);
  plan.unknownGafim = [...new Set(incoming.map((r) => r.gaf_name).filter((g) => !gafSet.has(g)))].sort();
  plan.unknownRanks = [...new Set(incoming.map((r) => r.rank_name).filter((r) => !rankSet.has(r)))].sort();
  return plan;
}

/** One field change of an existing soldier, as approved (or not) in the preview. */
export const changeKey = (id: string, field: keyof SoldierRecord) => `${id}:${field}`;

/**
 * Keeps only the approved changes of existing soldiers: a change not approved is cleared from
 * the record, so the load leaves the stored value as it is. A soldier left with no change is
 * counted as unchanged – unless he returns to activity, which the file itself decides.
 */
export function approvePlan(plan: RosterPlan, approved: Set<string>, deactivate: Set<string> = new Set()): RosterPlan {
  const updated: RosterPlan["updated"] = [];
  let unchanged = plan.unchanged;
  for (const u of plan.updated) {
    const changes = u.changes.filter((f) => approved.has(changeKey(u.id, f)));
    const after = { ...u.after } as Record<keyof SoldierRecord, unknown>;
    for (const f of u.changes) if (!changes.includes(f)) after[f] = null;
    if (changes.length || !u.before.is_active) updated.push({ ...u, after: after as unknown as SoldierRecord, changes });
    else unchanged++;
  }
  // moved to a framework not chosen: only the ones אחראי השיבוצים marked go inactive
  const removed = [...plan.removed, ...plan.movedOut.filter((m) => deactivate.has(m.soldier.id)).map((m) => m.soldier)];
  return { ...plan, updated, unchanged, removed };
}
