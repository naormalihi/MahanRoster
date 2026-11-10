/** The cycle workspace: its steps, the state of each one, and what to do next. */
import { deadlineDay, stageIndex, type Cycle, type CycleStatus } from "./cycles";

export type StepKey = "overview" | "constraints" | "potential" | "slots" | "schedule" | "operate";

export const STEPS: { key: StepKey; label: string; path: string }[] = [
  { key: "overview", label: "סקירה", path: "/cycle" },
  { key: "constraints", label: "אילוצים", path: "/cycle/constraints" },
  { key: "potential", label: "פוטנציאל", path: "/cycle/potential" },
  { key: "slots", label: "לוח הבסיס", path: "/cycle/slots" },
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
    schedule: published
      ? { tone: "done", text: cycle.published_at ? `פורסם ${short(cycle.published_at)}` : "פורסם" }
      : f.job && (f.job.status === "queued" || f.job.status === "running")
        ? { tone: "busy", text: "המנוע רץ" }
        : f.job?.status === "done"
          ? f.job.unfilled > 0
            ? { tone: "warn", text: `${f.job.unfilled} לא מאוישות` }
            : { tone: "done", text: "טיוטה מוכנה לפרסום" }
          : { tone: "todo", text: "לא שובץ" },
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

/** One line on what to do now, for the overview and the home page. */
export function nextAction(cycle: Cycle, f: CycleFacts): { text: string; step: StepKey } {
  const s = stepStates(cycle, f);
  switch (cycle.status) {
    case "draft":
    case "loading":
      return { text: "לטעון את קובץ כוח האדם העדכני ולעבור לאילוצים", step: "overview" };
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
      return f.slots ? { text: "המשימות נקלטו – אפשר להריץ שיבוץ", step: "schedule" } : { text: "לקלוט את קובץ לוח הבסיס", step: "slots" };
    case "scheduling":
    case "review":
      return s.schedule.tone === "warn"
        ? { text: `לאייש ידנית ${f.job?.unfilled} משימות ולפרסם`, step: "schedule" }
        : s.schedule.tone === "busy"
          ? { text: "המנוע רץ – הטיוטה תופיע כשיסיים", step: "schedule" }
          : f.job?.status === "done"
            ? { text: "לעבור על הטיוטה ולפרסם", step: "schedule" }
            : { text: "להריץ שיבוץ", step: "schedule" };
    default:
      return f.pendingAdditions
        ? { text: `לשבץ ${f.pendingAdditions} תורנויות שנוספו אחרי הפרסום`, step: "operate" }
        : { text: "המחזור פורסם. שינויים מכאן – בתפעול השוטף", step: "operate" };
  }
}
