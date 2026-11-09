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
  kind: "full" | "stability" | "simulation";
  progress: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  params: { dispatch?: "sent" | "no_token" | "unavailable"; run_url?: string | null; dispatched_at?: string };
  result_status: string | null;
  wall_time: number | null;
  unfilled: UnfilledOut[] | null;
  warnings: string[] | null;
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
