/** Scheduling runs (schedule_jobs) as the "שיבוץ" screen shows them. */

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface UnfilledOut {
  slot_id: string;
  role: "performer" | "reserve";
  missing: number;
  eligible_count: number;
  reasons: Record<string, number>;
}

export interface PoolStats {
  population: string;
  soldiers: number;
  mean_before: number;
  mean_after: number;
  min_after: number;
  max_after: number;
  stdev_after: number;
  max_weekends: number;
  max_reserves: number;
}

export interface ScheduleJob {
  id: string;
  status: JobStatus;
  kind: "full" | "stability" | "update" | "simulation";
  progress: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  params: {
    dispatch?: "sent" | "no_token" | "unavailable";
    run_url?: string | null;
    dispatched_at?: string;
    /** while running: duties staffed so far of all, and the month being solved */
    staffed?: number;
    slots?: number;
    month?: number;
    months?: number;
    /** searching for a first solution of the month, or improving the balance of one already found */
    phase?: "searching" | "improving" | "polishing";
  };
  result_status: string | null;
  wall_time: number | null;
  unfilled: UnfilledOut[] | null;
  warnings: string[] | null;
  /** on a failed run: which rule blocks, in words (from the engine's diagnosis) */
  diagnosis?: string | null;
  pools: PoolStats[] | null;
}

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  queued: "ממתין להפעלה",
  running: "רץ",
  done: "הסתיים",
  failed: "נכשל",
};

export const POOL_LABEL: Record<string, string> = { mandatory: "חובה", career: "קבע" };

/** A fairness group's name: its population and the duty categories its soldiers share. */
export function poolNames(snapshot: { fairness_group?: string | null; fairness_label?: string | null; balance_population: string }[]) {
  const names = new Map<string, string>();
  for (const s of snapshot) {
    const key = s.fairness_group || s.balance_population;
    if (!names.has(key)) names.set(key, [POOL_LABEL[s.balance_population] ?? s.balance_population, s.fairness_label].filter(Boolean).join(" · "));
  }
  return names;
}

/** What to show for a pool key; never a raw id. */
export const poolName = (names: Map<string, string>, key: string) =>
  names.get(key) ?? POOL_LABEL[key] ?? POOL_LABEL[key.split(":")[0]] ?? key;

export const isActive = (j: Pick<ScheduleJob, "status">) => j.status === "queued" || j.status === "running";

/** Seconds since a timestamp, for "waiting 2:15". */
export const elapsed = (fromIso: string, now = Date.now()) => Math.max(0, Math.round((now - Date.parse(fromIso)) / 1000));

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** A queued job nobody picked up for a while: the start request probably did not reach GitHub. */
export const looksStuck = (j: ScheduleJob, now = Date.now()) => j.status === "queued" && elapsed(j.created_at, now) > 120;

/** The most common reasons, "label (count)", for an unfilled slot. */
export function topReasons(reasons: Record<string, number>, labels: Record<string, string>, n = 3): string {
  return Object.entries(reasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, c]) => `${labels[k] ?? k} (${c})`)
    .join(" · ");
}


const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const FIXED_BREAKS = new RegExp(`^שיבוץ קבוע במשבצת (${UUID}) לחייל (${UUID}) מפר: (.+)$`);
const FIXED_UNKNOWN = new RegExp(`^שיבוץ קבוע במשבצת (${UUID}) לחייל לא מוכר (${UUID}) – הושמט$`);
const PENALTY_CLASH = new RegExp(`^משבצת קנס (${UUID}) מתנגשת אצל (${UUID}): (.+)$`);

/**
 * An engine warning in words: the duty and its date instead of a slot id, the soldier's name
 * instead of an id, and the rule in Hebrew instead of its code. Unknown formats pass through.
 */
export function warningText(
  w: string,
  slot: (id: string) => string,
  soldier: (id: string) => string,
  reasons: Record<string, string>,
  isSlot: (id: string) => boolean = () => false,
): string {
  const rules = (codes: string) => codes.split(/,\s*/).map((c) => reasons[c] ?? c).join("; ");
  let m = w.match(FIXED_BREAKS);
  if (m) return `שיבוץ ידני/מפורסם: ${soldier(m[2])} ב${slot(m[1])} – לא עומד בכלל: ${rules(m[3])}. השיבוץ נשאר; כדאי לבדוק.`;
  m = w.match(FIXED_UNKNOWN);
  if (m) return `שיבוץ ב${slot(m[1])} לחייל שכבר לא ברשימה – לא נכלל בהרצה.`;
  m = w.match(PENALTY_CLASH);
  if (m) return `משבצת קנס ב${slot(m[1])} של ${soldier(m[2])} מתנגשת: ${rules(m[3])}.`;
  // anything else (the independent check's findings among them): ids become duties and names
  return w
    .replace(/^verifier:\s*/, "")
    .replace(/\((performer|reserve)\)/g, (_, r) => (r === "performer" ? "(מבצע)" : "(עתודה)"))
    .replace(new RegExp(UUID, "g"), (id) => (isSlot(id) ? slot(id) : soldier(id)));
}

/** A failed run's error in words: the engine statuses become an explanation. */
export function jobErrorText(error: string | null | undefined, diagnosis?: string | null): string {
  const e = (error ?? "").trim();
  if (diagnosis) return `המנוע לא מצא שיבוץ שעומד בכל הכללים. ${diagnosis}`;
  if (/INFEASIBLE/.test(e))
    return "המנוע לא מצא שיבוץ שעומד בכל הכללים הקשיחים. בדרך כלל זה שיבוץ קבוע שמתנגש בכלל (חפיפה, תקרה חודשית, עתודה מגף אחר) – בדוק את השיבוצים שתוקנו ידנית והרץ שוב.";
  if (/MODEL_INVALID/.test(e)) return "הבדיקה העצמאית מצאה הפרה של כלל קשיח בתוצאה, ולכן היא לא נשמרה.";
  if (/UNKNOWN/.test(e)) return "המנוע לא הספיק למצוא פתרון בזמן שהוקצב. נסה להריץ שוב.";
  return e;
}
