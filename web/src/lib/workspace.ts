/** The cycle workspace: its steps, the state of each one, and what to do next. */
import { deadlineDay, stageIndex, type Cycle, type CycleStatus } from "./cycles";

export type StepKey = "overview" | "constraints" | "potential" | "slots" | "schedule" | "operate";

export const STEPS: { key: StepKey; label: string; path: string }[] = [
  { key: "overview", label: "סקירה", path: "/cycle" },
  { key: "constraints", label: "אילוצים", path: "/cycle/constraints" },
  { key: "potential", label: "פוטנציאל", path: "/cycle/potential" },
  { key: "slots", label: "טעינת לוח משימות", path: "/cycle/slots" },
  { key: "schedule", label: "שיבוץ", path: "/cycle/schedule" },
  { key: "operate", label: "תפעול", path: "/cycle/operate" },
];

export type Tone = "done" | "todo" | "warn" | "busy";

export interface StepState {
  tone: Tone;
  text: string;
}

export interface CycleFacts {
  pendingExemptions: number;
  slots: number;
  job: { status: string; unfilled: number } | null;
  /** published cycle: duties with nothing published on them yet (added after publishing) */
  pendingAdditions?: number;
  /**
   * Before publishing – the draft as it is now, not the last run: performers placed, and performer
   * places still open. A draft that was cleared (or duties reloaded) after a run is not "ready".
   */
  draft?: { placed: number; unfilled: number };
}

/** The draft as it is now: performers placed and performer places still open (any role but reserve). */
export function draftFacts(
  slots: { id: string; performers_needed: number }[],
  assignments: { slot_id: string; role: string; status: string }[],
): { placed: number; unfilled: number } {
  const per = new Map<string, number>();
  for (const a of assignments) if (a.role === "performer" && a.status === "draft") per.set(a.slot_id, (per.get(a.slot_id) ?? 0) + 1);
  let placed = 0;
  let unfilled = 0;
  for (const s of slots) {
    const n = per.get(s.id) ?? 0;
    placed += n;
    unfilled += Math.max(0, s.performers_needed - n);
  }
  return { placed, unfilled };
}

/** The run's result, or – when known – the draft as it is now. */
function draftState(f: CycleFacts): "none" | "busy" | { unfilled: number } {
  if (f.job && (f.job.status === "queued" || f.job.status === "running")) return "busy";
  if (f.draft) return f.draft.placed > 0 ? { unfilled: f.draft.unfilled } : "none";
  return f.job?.status === "done" ? { unfilled: f.job.unfilled } : "none";
}

const short = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${Number(d)}.${Number(m)}`;
};

export function stepStates(cycle: Cycle, f: CycleFacts): Record<Exclude<StepKey, "overview">, StepState> {
  const at = stageIndex(cycle.status);
  const published = at >= stageIndex("published");
  const deadline = cycle.exemption_deadline;
  return {
    // the constraints row always carries the deadline: "איסוף עד 11.11" / "נסגר 11.11"
    constraints: (() => {
      const open = !!deadline && Date.parse(deadline) > Date.now();
      const when = deadline ? `${open ? "איסוף עד" : "נסגר"} ${short(deadlineDay(deadline))}` : "לא נקבע מועד סגירה";
      if (f.pendingExemptions > 0) return { tone: "warn", text: `${when} · ${f.pendingExemptions} פטורים ממתינים` };
      if (!deadline && !published) return { tone: "warn", text: when };
      if (open && at <= stageIndex("collecting")) return { tone: "todo", text: when };
      return { tone: "done", text: deadline ? `${when} · אין ממתינים` : "אין ממתינים" };
    })(),
    potential: cycle.potential_computed_at
      ? { tone: "done", text: `חושב ${short(cycle.potential_computed_at)}` }
      : { tone: "todo", text: "לא חושב" },
    slots: f.slots > 0 ? { tone: "done", text: `${f.slots} משימות` } : { tone: "todo", text: "לא נקלט" },
    schedule: (() => {
      if (published) return { tone: "done", text: cycle.published_at ? `פורסם ${short(cycle.published_at)}` : "פורסם" };
      const d = draftState(f);
      if (d === "busy") return { tone: "busy", text: "המנוע רץ" };
      if (d === "none") return { tone: "todo", text: "לא שובץ" };
      return d.unfilled > 0 ? { tone: "warn", text: `${d.unfilled} לא מאוישות` } : { tone: "done", text: "טיוטה מוכנה לפרסום" };
    })() as StepState,
    operate: !published
      ? { tone: "todo", text: "אחרי הפרסום" }
      : f.pendingAdditions
        ? { tone: "warn", text: `${f.pendingAdditions} ממתינות לשיבוץ` }
        : { tone: "done", text: "הלוח מאויש" },
  };
}

/** The step a stage is worked on. */
export const STAGE_STEP: Record<CycleStatus, StepKey> = {
  draft: "overview",
  loading: "overview",
  collecting: "constraints",
  approving: "constraints",
  potential: "potential",
  slots: "slots",
  scheduling: "schedule",
  review: "schedule",
  published: "operate",
  closed: "schedule",
};

const stepPath = (k: StepKey) => STEPS.find((s) => s.key === k)!.path;

/** One line on what to do now, for the overview and the home page, and the screen it is done on. */
export function nextAction(cycle: Cycle, f: CycleFacts): { text: string; step: StepKey; path: string } {
  const a = nextActionStep(cycle, f);
  // loading the personnel file has its own screen, outside the cycle's steps
  const path = cycle.status === "draft" || cycle.status === "loading" ? "/soldiers/import" : stepPath(a.step);
  return { ...a, path };
}

function nextActionStep(cycle: Cycle, f: CycleFacts): { text: string; step: StepKey } {
  const s = stepStates(cycle, f);
  switch (cycle.status) {
    case "draft":
    case "loading":
      return { text: "לטעון את קובץ כוח האדם העדכני ולעבור לאילוצים", step: "overview" };
    case "collecting":
    case "approving":
      return f.pendingExemptions > 0
        ? { text: `לאשר או לדחות ${f.pendingExemptions} פטורים ממתינים`, step: "constraints" }
        : { text: "להזין את האילוצים שהגיעו מהמסגרות ולסגור את האיסוף", step: "constraints" };
    case "potential":
      return cycle.potential_computed_at
        ? { text: "לבדוק את המטריצה ולייצא לבסיס", step: "potential" }
        : { text: "לחשב את הפוטנציאל", step: "potential" };
    case "slots":
      return f.slots ? { text: "המשימות נקלטו – אפשר להריץ שיבוץ", step: "schedule" } : { text: "לקלוט את קובץ לוח המשימות", step: "slots" };
    case "scheduling":
    case "review":
      return s.schedule.tone === "warn"
        ? { text: `לאייש ידנית ${s.schedule.text.split(" ")[0]} משימות ולפרסם`, step: "schedule" }
        : s.schedule.tone === "busy"
          ? { text: "המנוע רץ – הטיוטה תופיע כשיסיים", step: "schedule" }
          : s.schedule.tone === "done"
            ? { text: "לעבור על הטיוטה ולפרסם", step: "schedule" }
            : { text: "להריץ שיבוץ", step: "schedule" };
    default:
      return f.pendingAdditions
        ? { text: `לשבץ ${f.pendingAdditions} משימות שנוספו אחרי הפרסום`, step: "operate" }
        : { text: "המחזור פורסם. שינויים מכאן – בתפעול השוטף", step: "operate" };
  }
}

/** A published assignment that is live on the board (not a draft). */
const liveA = (a: { status: string }) => a.status !== "draft";
/** Who performs: a performer, or a reserve that was activated. */
const performsA = (a: { role: string; status: string }) => a.role === "performer" || a.status === "reserve_activated";

/**
 * Duties of a published cycle that wait for staffing: not ended, and missing a published performer
 * or reserve (added after publishing, left unfilled, or a reserve that was activated).
 */
export function pendingSlots<S extends { id: string; ends_at: string; performers_needed: number; reserves_needed: number }>(
  slots: S[],
  assignments: { slot_id: string; role: string; status: string }[],
  now = Date.now(),
): S[] {
  const bySlot = new Map<string, { role: string; status: string }[]>();
  for (const a of assignments) if (liveA(a) && !["dropped", "swapped_out", "cancelled_approved"].includes(a.status)) bySlot.set(a.slot_id, [...(bySlot.get(a.slot_id) ?? []), a]);
  return slots.filter((k) => {
    if (Date.parse(k.ends_at) <= now) return false;
    const mine = bySlot.get(k.id) ?? [];
    return mine.filter(performsA).length < k.performers_needed || mine.filter((a) => !performsA(a)).length < k.reserves_needed;
  });
}

/** The way on from a step of the workspace: always open, with a word on what is still left. */
export interface StepNav {
  prev: { label: string; path: string } | null;
  next: { label: string; path: string } | null;
  /** what is still open in this step – it does not hold the way on */
  note: string | null;
}

export function stepNav(step: StepKey, cycle: Cycle, f: CycleFacts | null): StepNav {
  const at = STEPS.findIndex((s) => s.key === step);
  const prevStep = at > 0 ? STEPS[at - 1] : null;
  const prev = prevStep && { label: prevStep.label, path: prevStep.path };
  const to = (k: StepKey) => ({ label: STEPS.find((s) => s.key === k)!.label, path: stepPath(k) });
  const published = stageIndex(cycle.status) >= stageIndex("published");
  const deadline = cycle.exemption_deadline;
  switch (step) {
    case "overview": {
      const a = f && nextAction(cycle, f);
      return { prev: null, next: a && a.path !== "/cycle" ? { label: a.path === "/soldiers/import" ? "טעינת כוח אדם" : to(a.step).label, path: a.path } : null, note: null };
    }
    case "constraints": {
      const open = !!deadline && Date.parse(deadline) > Date.now() && !published;
      const parts = [
        f && f.pendingExemptions > 0 ? `${f.pendingExemptions} פטורים עוד ממתינים להחלטה` : null,
        open ? `האיסוף פתוח עד ${short(deadlineDay(deadline!))}` : null,
      ].filter(Boolean);
      return { prev, next: to("potential"), note: parts.length ? `${parts.join(" · ")}. אפשר להמשיך ולחזור לכאן בכל שלב.` : null };
    }
    case "potential":
      return { prev, next: to("slots"), note: cycle.potential_computed_at ? null : "הפוטנציאל עוד לא חושב." };
    case "slots":
      return { prev, next: to("schedule"), note: f && f.slots === 0 ? "עוד לא נקלטו משימות – בלי משימות אין מה לשבץ." : null };
    case "schedule":
      return published
        ? { prev, next: to("operate"), note: null }
        : { prev, next: null, note: "הצעד הבא: לעבור על הטיוטה ולפרסם. אחרי הפרסום ממשיכים לתפעול." };
    case "operate":
      return { prev, next: null, note: null };
  }
}
