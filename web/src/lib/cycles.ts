/** Cycles and the constraints collected for them (exemptions, absences, date blocks). */

import { TZ, dayKey } from "./dates";
import { toIsoDate } from "./roster";

// ---------------------------------------------------------------------------
// Cycles
// ---------------------------------------------------------------------------

export type CycleStatus =
  | "draft"
  | "loading"
  | "collecting"
  | "approving"
  | "potential"
  | "slots"
  | "scheduling"
  | "review"
  | "published"
  | "closed";

export const STAGES: { status: CycleStatus; label: string; hint: string }[] = [
  { status: "draft", label: "הקמת המחזור", hint: "המחזור נוצר. קובעים תאריכים ומועד סגירת אילוצים." },
  { status: "loading", label: "טעינת כוח אדם", hint: "טוענים את קובץ כוח האדם העדכני ובודקים את רשימת העובדים." },
  { status: "collecting", label: "אילוצים: איסוף", hint: "מזינים פטורים, היעדרויות וחסימות שהגיעו מהמסגרות, עד מועד הסגירה." },
  { status: "approving", label: "אילוצים: אישור פטורים", hint: "בודקים אסמכתאות ומאשרים או דוחים כל פטור." },
  { status: "potential", label: "פוטנציאל", hint: "מפיקים את מטריצת הפוטנציאל ושולחים לבסיס." },
  { status: "slots", label: "טעינת לוח משימות", hint: "טוענים את קובץ המשימות שהגיע מהבסיס." },
  { status: "scheduling", label: "שיבוץ: הרצה", hint: "מריצים את מנוע השיבוץ." },
  { status: "review", label: "שיבוץ: טיוטה", hint: "בודקים את הטיוטה, מתקנים ידנית, אוספים הערות מהמסגרות ומפרסמים." },
  { status: "published", label: "תפעול", hint: "הלוח פורסם. מכאן: משימות חדשות, הקפצות והפעלת עתודות." },
  { status: "closed", label: "סגור", hint: "המחזור הסתיים." },
];

export const stageIndex = (s: CycleStatus) => STAGES.findIndex((x) => x.status === s);
/** The screen each stage is worked on – every step of the stepper opens it. */
export const STAGE_SCREEN: Record<CycleStatus, { staff: string; reader: string }> = {
  draft: { staff: "/cycles", reader: "/cycle" },
  loading: { staff: "/soldiers/import", reader: "/soldiers" },
  collecting: { staff: "/cycle/constraints", reader: "/cycle/constraints" },
  approving: { staff: "/cycle/constraints?tab=exemptions&status=pending", reader: "/cycle/constraints?tab=exemptions" },
  potential: { staff: "/cycle/potential", reader: "/cycle/potential" },
  slots: { staff: "/cycle/slots", reader: "/cycle/slots" },
  scheduling: { staff: "/cycle/schedule", reader: "/cycle/schedule" },
  review: { staff: "/cycle/schedule", reader: "/cycle/schedule" },
  published: { staff: "/cycle/operate", reader: "/board" },
  closed: { staff: "/board", reader: "/board" },
};

export const stageLabel = (s: CycleStatus) => STAGES[stageIndex(s)]?.label ?? s;

export interface Cycle {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  exemption_deadline: string | null; // ISO timestamp
  status: CycleStatus;
  published_at: string | null;
  potential_computed_at?: string | null;
}

export type CycleInput = Pick<Cycle, "name" | "start_date" | "end_date" | "exemption_deadline">;

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDate = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
};
export const addDaysIso = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDate(y, m, d + n);
};
export const addMonthsIso = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDate(y, m + n, d);
};

const HEB_MONTH = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

/** Next cycle: starts the day after the last one ends (or the first of next month), six months long. */
export function suggestCycle(existing: Pick<Cycle, "end_date">[], today: string, months = 6, deadlineDays = 40): CycleInput {
  const last = existing.map((c) => c.end_date).sort().at(-1);
  const [ty, tm] = today.split("-").map(Number);
  const start = last && last >= today ? addDaysIso(last, 1) : isoDate(ty, tm + 1, 1);
  const end = addDaysIso(addMonthsIso(start, months), -1);
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  const name = sy === ey ? `${HEB_MONTH[sm - 1]}–${HEB_MONTH[em - 1]} ${sy}` : `${HEB_MONTH[sm - 1]} ${sy} – ${HEB_MONTH[em - 1]} ${ey}`;
  return { name, start_date: start, end_date: end, exemption_deadline: endOfDay(addDaysIso(start, -deadlineDays)) };
}

export function cycleProblems(c: CycleInput, others: Cycle[], selfId?: string): string[] {
  const p: string[] = [];
  if (!c.name.trim()) p.push("חסר שם");
  if (!c.start_date || !c.end_date) p.push("חסרים תאריכים");
  else if (c.end_date <= c.start_date) p.push("תאריך הסיום חייב להיות אחרי תאריך ההתחלה");
  else {
    const clash = others.find((o) => o.id !== selfId && o.start_date <= c.end_date && o.end_date >= c.start_date);
    if (clash) p.push(`חופף למחזור "${clash.name}"`);
  }
  return p;
}

/** The cycle running on a day, else the next one to start, else the latest. */
export function currentCycle<T extends Pick<Cycle, "start_date" | "end_date" | "status">>(cycles: T[], today: string): T | null {
  const open = cycles.filter((c) => c.status !== "closed");
  return (
    open.find((c) => c.start_date <= today && c.end_date >= today) ??
    open.filter((c) => c.start_date > today).sort((a, b) => a.start_date.localeCompare(b.start_date))[0] ??
    [...cycles].sort((a, b) => b.start_date.localeCompare(a.start_date))[0] ??
    null
  );
}

/** The cycle being prepared (not yet published), earliest first; else the current one. */
export function planningCycle<T extends Pick<Cycle, "start_date" | "end_date" | "status">>(cycles: T[], today: string): T | null {
  const preparing = cycles
    .filter((c) => stageIndex(c.status) < stageIndex("published"))
    .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  return preparing ?? currentCycle(cycles, today);
}

// ---------------------------------------------------------------------------
// Time: whole days in the unit's time zone
// ---------------------------------------------------------------------------

/** UTC offset of the unit's time zone at a given instant, e.g. "+03:00". */
function offsetAt(instant: Date): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" })
    .formatToParts(instant)
    .find((p) => p.type === "timeZoneName")!.value; // "GMT+03:00" or "GMT"
  return part === "GMT" ? "+00:00" : part.slice(3);
}

/** Midnight at the start of a local day, as an ISO timestamp with offset. */
/** The constraints deadline is the last day to submit, until 23:59 local time. */
export function endOfDay(day: string): string {
  const off = offsetAt(new Date(`${day}T12:00:00Z`));
  return `${day}T23:59:59${off}`;
}

/** The local day of a deadline timestamp (YYYY-MM-DD). */
export const deadlineDay = (iso: string) => dayKey(iso);

export function localMidnight(day: string): string {
  // the offset at local noon is the day's offset (DST switches happen at night)
  const off = offsetAt(new Date(`${day}T12:00:00Z`));
  return `${day}T00:00:00${off}`;
}

// ---------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------

export type RequestStatus = "pending" | "approved" | "rejected" | "expired" | "cancelled";
export type ReceivedVia = "in_person" | "phone" | "message" | "excel" | "system";

export const STATUS_LABEL: Record<RequestStatus, string> = {
  pending: "ממתין",
  approved: "אושר",
  rejected: "נדחה",
  expired: "פג תוקף",
  cancelled: "בוטל",
};

export const VIA_LABEL: Record<ReceivedVia, string> = {
  in_person: "פנים אל פנים",
  phone: "טלפון",
  message: "הודעה",
  excel: "קובץ אקסל",
  system: "מערכת",
};

export interface ExemptionType {
  id: string;
  name: string;
  qualifies_day_only: boolean;
  allows_partial_restriction: boolean;
  /** ת"ש 7: no duty that covers night hours, for the exemption's dates */
  home_nightly?: boolean;
  /** פטור חלקי: saved only with the duties the employee can't do */
  requires_duty_list?: boolean;
  /** false: set aside – kept for the exemptions saved with it, not offered for new ones */
  is_active?: boolean;
}

export interface Exemption {
  id: string;
  soldier_id: string;
  exemption_type_id: string;
  kind: "full" | "partial";
  start_date: string;
  end_date: string;
  excluded_task_type_ids: string[] | null;
  restricted_hours: string | null;
  is_urgent: boolean;
  status: RequestStatus;
  source: "soldier" | "coordinator" | "computed";
  proof_checked_at: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  received_via: ReceivedVia | null;
  received_at: string | null;
  /** staff only, no medical details – never shown to the employee */
  internal_note?: string | null;
}

/** A פטור חלקי saved before 2.60 without its duties – it excludes every duty. */
export function missingDutyList(e: Exemption, types: ExemptionType[]): boolean {
  return (e.status === "pending" || e.status === "approved") && !e.excluded_task_type_ids?.length &&
    !!types.find((t) => t.id === e.exemption_type_id)?.requires_duty_list;
}

export type ExemptionInput = Pick<
  Exemption,
  | "soldier_id"
  | "exemption_type_id"
  | "kind"
  | "start_date"
  | "end_date"
  | "excluded_task_type_ids"
  | "restricted_hours"
  | "is_urgent"
  | "received_via"
> & { internal_note?: string | null };

/** Staff edit an exemption (2.61). */
export interface ExemptionUpdate {
  id: string;
  exemption_type_id: string;
  start_date: string;
  end_date: string;
  kind: "full" | "partial";
  excluded_task_type_ids: string[] | null;
  restricted_hours: string | null;
  internal_note: string | null;
  /** the type changed on an approved exemption: the proof was checked again */
  proof_rechecked: boolean;
}

export type ExemptionDecision =
  | { action: "approve" }
  | { action: "reject"; reason: string }
  | { action: "cancel"; reason: string };

export function exemptionProblems(e: ExemptionInput): string[] {
  const p: string[] = [];
  if (!e.soldier_id) p.push("בחר עובד");
  if (!e.exemption_type_id) p.push("בחר סוג פטור");
  if (!e.start_date || !e.end_date) p.push("חסרים תאריכים");
  else if (e.end_date < e.start_date) p.push("תאריך הסיום לפני תאריך ההתחלה");
  if (e.restricted_hours && !/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(e.restricted_hours)) p.push("חלון שעות בתבנית 22:00-06:00");
  if (e.kind === "partial" && !e.excluded_task_type_ids?.length && !e.restricted_hours)
    p.push("בפטור חלקי צריך לבחור משימות או חלון שעות");
  return p;
}

export interface AbsenceType {
  id: string;
  name: string;
}

export interface Absence {
  id: string;
  soldier_id: string;
  absence_type_id: string;
  starts_at: string;
  ends_at: string;
  status: "active" | "cancelled";
  cancel_reason: string | null;
  received_via: ReceivedVia | null;
}

/** An absence as entered: whole days, both ends inclusive. */
export interface AbsenceInput {
  soldier_id: string;
  absence_type_id: string;
  from: string;
  to: string;
  received_via: ReceivedVia | null;
}

export const absenceSpan = (a: Pick<AbsenceInput, "from" | "to">) => ({
  starts_at: localMidnight(a.from),
  ends_at: localMidnight(addDaysIso(a.to, 1)),
});

/** The inclusive local days an absence covers (its end is the next midnight). */
export function absenceDays(a: Pick<Absence, "starts_at" | "ends_at">): { from: string; to: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const from = fmt.format(new Date(a.starts_at));
  const to = fmt.format(new Date(Date.parse(a.ends_at) - 1));
  return { from, to };
}

export interface DateBlock {
  id: string;
  soldier_id: string;
  cycle_id: string | null;
  day: string;
  status: "active" | "cancelled";
  received_via: ReceivedVia | null;
}

export interface DateBlockInput {
  soldier_id: string;
  day: string;
  received_via: ReceivedVia | null;
}

/** Blocks a soldier would have in each month, counting the existing active ones. */
export function blockQuotaProblems(
  incoming: Pick<DateBlockInput, "soldier_id" | "day">[],
  existing: Pick<DateBlock, "soldier_id" | "day" | "status">[],
  perMonth: number,
): Map<number, string> {
  const count = new Map<string, number>();
  const key = (s: string, d: string) => `${s}|${d.slice(0, 7)}`;
  for (const b of existing) if (b.status === "active") count.set(key(b.soldier_id, b.day), (count.get(key(b.soldier_id, b.day)) ?? 0) + 1);
  const out = new Map<number, string>();
  incoming.forEach((b, i) => {
    const k = key(b.soldier_id, b.day);
    const n = (count.get(k) ?? 0) + 1;
    if (n > perMonth) out.set(i, `מעבר למכסה: ${perMonth} חסימה לחודש`);
    else count.set(k, n);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Gaf constraint template (Excel): absences and date blocks
// ---------------------------------------------------------------------------

/**
 * The template is generated per gaf, one row per soldier, with the system id in
 * the first column, so it needs no personal numbers. A soldier with more than one
 * absence gets the row copied.
 */
export const TEMPLATE_HEADERS = ["מזהה (לא לשנות)", "שם מלא", "מסגרת", "תאריך חסימה", "סוג היעדרות", "היעדרות מתאריך", "היעדרות עד תאריך"];

export interface TemplateSoldier {
  id: string;
  full_name: string;
  gaf_name: string;
}

export function templateRows(soldiers: TemplateSoldier[]): (string | null)[][] {
  return [
    TEMPLATE_HEADERS,
    ...[...soldiers]
      .sort((a, b) => a.gaf_name.localeCompare(b.gaf_name, "he") || a.full_name.localeCompare(b.full_name, "he"))
      .map((s) => [s.id, s.full_name, s.gaf_name, null, null, null, null]),
  ];
}

export interface ParsedConstraints {
  blocks: (DateBlockInput & { line: number; name: string })[];
  absences: (AbsenceInput & { line: number; name: string })[];
  errors: { line: number; message: string }[];
}

export function parseTemplate(
  rows: unknown[][],
  soldiers: TemplateSoldier[],
  absenceTypes: AbsenceType[],
  range: { from: string; to: string },
): ParsedConstraints {
  const out: ParsedConstraints = { blocks: [], absences: [], errors: [] };
  const byId = new Map(soldiers.map((s) => [s.id, s]));
  const typeByName = new Map(absenceTypes.map((t) => [t.name.replace(/\s/g, ""), t.id]));
  const cell = (r: unknown[], i: number) => (r[i] === undefined || r[i] === null ? "" : r[i]);
  const blank = (v: unknown) => String(v ?? "").trim() === "";
  const inRange = (d: string) => d >= range.from && d <= range.to;
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const [idCell, , , blockCell, typeCell, fromCell, toCell] = [0, 1, 2, 3, 4, 5, 6].map((k) => cell(r, k));
    if ([blockCell, typeCell, fromCell, toCell].every(blank)) return; // nothing filled in
    const s = byId.get(String(idCell).trim());
    if (!s) return void out.errors.push({ line, message: "מזהה העובד לא מוכר. אל תשנה את העמודה הראשונה" });
    if (!blank(blockCell)) {
      const d = toIsoDate(blockCell);
      if (!d || d === "invalid") out.errors.push({ line, message: `${s.full_name}: תאריך חסימה לא תקין` });
      else if (!inRange(d)) out.errors.push({ line, message: `${s.full_name}: תאריך החסימה מחוץ למחזור` });
      else out.blocks.push({ line, name: s.full_name, soldier_id: s.id, day: d, received_via: "excel" });
    }
    if (![typeCell, fromCell, toCell].every(blank)) {
      const typeId = typeByName.get(String(typeCell).replace(/\s/g, ""));
      const from = toIsoDate(fromCell);
      const to = blank(toCell) ? from : toIsoDate(toCell);
      if (!typeId) out.errors.push({ line, message: `${s.full_name}: סוג היעדרות לא מוכר ("${String(typeCell)}")` });
      else if (!from || from === "invalid" || !to || to === "invalid")
        out.errors.push({ line, message: `${s.full_name}: תאריכי היעדרות לא תקינים` });
      else if (to < from) out.errors.push({ line, message: `${s.full_name}: ההיעדרות מסתיימת לפני שהיא מתחילה` });
      else if (to < range.from || from > range.to) out.errors.push({ line, message: `${s.full_name}: ההיעדרות מחוץ למחזור` });
      else out.absences.push({ line, name: s.full_name, soldier_id: s.id, absence_type_id: typeId, from, to, received_via: "excel" });
    }
  });
  return out;
}

/** Drop rows that repeat what is already recorded (same soldier and day / same span). */
export function dedupeConstraints(
  parsed: ParsedConstraints,
  existingBlocks: Pick<DateBlock, "soldier_id" | "day" | "status">[],
  existingAbsences: Pick<Absence, "soldier_id" | "starts_at" | "ends_at" | "status" | "absence_type_id">[],
) {
  const bk = new Set(existingBlocks.filter((b) => b.status === "active").map((b) => `${b.soldier_id}|${b.day}`));
  const ak = new Set(
    existingAbsences
      .filter((a) => a.status === "active")
      .map((a) => {
        const d = absenceDays(a);
        return `${a.soldier_id}|${a.absence_type_id}|${d.from}|${d.to}`;
      }),
  );
  const blocks = parsed.blocks.filter((b) => !bk.has(`${b.soldier_id}|${b.day}`));
  const absences = parsed.absences.filter((a) => !ak.has(`${a.soldier_id}|${a.absence_type_id}|${a.from}|${a.to}`));
  return { blocks, absences, skipped: parsed.blocks.length - blocks.length + parsed.absences.length - absences.length };
}

// ----- automatic stages: the stage follows what was done (see migration 39) -----

export type StageTone = "done" | "warn" | "todo" | "busy";
export interface StageState {
  stage: CycleStatus;
  tone: StageTone;
  note: string;
}
/** What the stages are judged by, besides the cycle row itself. */
export interface StageFacts {
  rosterAt: string | null; // last personnel file loaded since the cycle was created
  pending: number; // exemptions of the cycle waiting for a decision
  slots: number;
  job: "queued" | "running" | "done" | "failed" | null; // the last run
}

const EARLY: CycleStatus[] = ["draft", "loading", "collecting", "approving", "potential", "slots"];
const ddmm = (iso: string) => iso.slice(5, 10).split("-").reverse().join("/");

/** The stage a cycle is in by its facts – the same rule as app.cycle_auto_status. */
export function autoStatus(c: Cycle, f: StageFacts, now: Date, today: string): CycleStatus {
  if (c.status === "published" && c.end_date < today) return "closed";
  if (!EARLY.includes(c.status)) return c.status;
  if (!f.rosterAt) return "loading";
  if (!c.exemption_deadline || Date.parse(c.exemption_deadline) > now.getTime()) return "collecting";
  if (f.pending > 0) return "approving";
  if (!c.potential_computed_at) return "potential";
  return "slots";
}

/** Each stage with its state and a short note – the same as public.cycle_stages. */
export function stageStates(c: Cycle, f: StageFacts, now: Date): StageState[] {
  const closedAt = c.exemption_deadline ? Date.parse(c.exemption_deadline) : null;
  const deadlinePassed = closedAt !== null && closedAt <= now.getTime();
  const out = c.status === "published" || c.status === "closed";
  return [
    { stage: "draft", tone: "done", note: "" },
    { stage: "loading", tone: f.rosterAt ? "done" : "todo", note: f.rosterAt ? `נטען ${ddmm(f.rosterAt)}` : "צריך לטעון קובץ כוח אדם עדכני" },
    {
      stage: "collecting",
      tone: closedAt === null ? "warn" : deadlinePassed ? "done" : "todo",
      note: closedAt === null ? "לא נקבע מועד סגירה" : `${deadlinePassed ? "נסגר" : "פתוח עד"} ${ddmm(deadlineDay(c.exemption_deadline!))}`,
    },
    { stage: "approving", tone: f.pending > 0 ? "warn" : deadlinePassed ? "done" : "todo", note: f.pending > 0 ? `${f.pending} ממתינים` : "אין ממתינים" },
    {
      stage: "potential",
      tone: c.potential_computed_at ? "done" : "todo",
      note: c.potential_computed_at ? `חושב ${ddmm(c.potential_computed_at)}` : "לא חושב",
    },
    { stage: "slots", tone: f.slots > 0 ? "done" : "todo", note: f.slots > 0 ? `${f.slots} משימות` : "לא נקלט" },
    {
      stage: "scheduling",
      tone: f.job === "queued" || f.job === "running" ? "busy" : f.job === "done" ? "done" : f.job === "failed" ? "warn" : "todo",
      note: f.job === "queued" || f.job === "running" ? "רץ" : f.job === "done" ? "הושלם" : f.job === "failed" ? "נכשל" : "לא הורץ",
    },
    { stage: "review", tone: out ? "done" : "todo", note: out ? "אושרה" : f.job === "done" ? "מחכה לבדיקה ולפרסום" : "" },
    { stage: "published", tone: out ? "done" : "todo", note: c.published_at ? `פורסם ${ddmm(c.published_at)}` : "" },
    { stage: "closed", tone: c.status === "closed" ? "done" : "todo", note: `אחרי ${ddmm(c.end_date)}` },
  ];
}
