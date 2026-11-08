/** The cycle workspace: its steps, the state of each one, and what to do next. */
import { stageIndex, type Cycle, type CycleStatus } from "./cycles";

export type StepKey = "overview" | "constraints" | "potential" | "slots" | "schedule";

export const STEPS: { key: StepKey; label: string; path: string }[] = [
  { key: "overview", label: "סקירה", path: "/cycle" },
  { key: "constraints", label: "אילוצים", path: "/cycle/constraints" },
  { key: "potential", label: "פוטנציאל", path: "/cycle/potential" },
  { key: "slots", label: "לוח הבסיס", path: "/cycle/slots" },
  { key: "schedule", label: "שיבוץ וטיוטה", path: "/cycle/schedule" },
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
    constraints:
      f.pendingExemptions > 0
        ? { tone: "warn", text: `${f.pendingExemptions} פטורים ממתינים` }
        : at <= stageIndex("collecting") && deadline && Date.parse(deadline) > Date.now()
          ? { tone: "todo", text: `איסוף עד ${short(deadline)}` }
          : { tone: "done", text: "אין ממתינים" },
    potential: cycle.potential_computed_at
      ? { tone: "done", text: `חושב ${short(cycle.potential_computed_at)}` }
      : { tone: "todo", text: "לא חושב" },
    slots: f.slots > 0 ? { tone: "done", text: `${f.slots} משבצות` } : { tone: "todo", text: "לא נקלט" },
    schedule: published
      ? { tone: "done", text: cycle.published_at ? `פורסם ${short(cycle.published_at)}` : "פורסם" }
      : f.job && (f.job.status === "queued" || f.job.status === "running")
        ? { tone: "busy", text: "המנוע רץ" }
        : f.job?.status === "done"
          ? f.job.unfilled > 0
            ? { tone: "warn", text: `${f.job.unfilled} לא מאוישות` }
            : { tone: "done", text: "טיוטה מוכנה לפרסום" }
          : { tone: "todo", text: "לא שובץ" },
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
  published: "schedule",
  closed: "schedule",
};

/** One line on what to do now, for the overview and the home page. */
export function nextAction(cycle: Cycle, f: CycleFacts): { text: string; step: StepKey } {
  const s = stepStates(cycle, f);
  switch (cycle.status) {
    case "draft":
    case "loading":
      return { text: "לטעון את קובץ כוח האדם העדכני ולעבור לאיסוף אילוצים", step: "overview" };
    case "collecting":
    case "approving":
      return f.pendingExemptions > 0
        ? { text: `לאשר או לדחות ${f.pendingExemptions} פטורים ממתינים`, step: "constraints" }
        : { text: "להזין את האילוצים שהגיעו מהגפים ולסגור את האיסוף", step: "constraints" };
    case "potential":
      return cycle.potential_computed_at
        ? { text: "לבדוק את המטריצה ולייצא לבסיס", step: "potential" }
        : { text: "לחשב את הפוטנציאל", step: "potential" };
    case "slots":
      return f.slots ? { text: "המשבצות נקלטו – אפשר להריץ שיבוץ", step: "schedule" } : { text: "לקלוט את קובץ לוח הבסיס", step: "slots" };
    case "scheduling":
    case "review":
      return s.schedule.tone === "warn"
        ? { text: `לאייש ידנית ${f.job?.unfilled} משבצות ולפרסם`, step: "schedule" }
        : s.schedule.tone === "busy"
          ? { text: "המנוע רץ – הטיוטה תופיע כשיסיים", step: "schedule" }
          : f.job?.status === "done"
            ? { text: "לעבור על הטיוטה ולפרסם", step: "schedule" }
            : { text: "להריץ שיבוץ", step: "schedule" };
    default:
      return { text: "המחזור פורסם. שינויים מכאן – בתפעול השוטף", step: "schedule" };
  }
}
