import { describe, expect, it } from "vitest";
import type { Cycle } from "../cycles";
import { nextAction, stepStates } from "../workspace";
import { defaultCycle } from "../cycleContext";

const cycle = (o: Partial<Cycle> = {}): Cycle => ({
  id: "c", name: "ינואר–יוני 2027", start_date: "2027-01-01", end_date: "2027-06-30", exemption_deadline: null,
  status: "collecting", published_at: null, potential_computed_at: null, ...o,
});
const facts = { pendingExemptions: 0, slots: 0, job: null };

describe("cycle workspace", () => {
  it("shows what blocks each step", () => {
    const s = stepStates(cycle(), { pendingExemptions: 3, slots: 307, job: { status: "done", unfilled: 2 } });
    expect(s.constraints).toEqual({ tone: "warn", text: "לא נקבע מועד סגירה · 3 פטורים ממתינים" });
    const closed = stepStates(cycle({ exemption_deadline: "2026-11-11T23:59:59+02:00" }), { ...facts, pendingExemptions: 0 });
    expect(closed.constraints.text).toMatch(/^(נסגר|איסוף עד) 11\.11/);
    expect(s.potential.tone).toBe("todo");
    expect(s.slots.text).toBe("307 משימות");
    expect(s.schedule).toEqual({ tone: "warn", text: "2 לא מאוישות" });
    expect(stepStates(cycle({ status: "published", published_at: "2026-11-08T10:00:00Z" }), facts).schedule.text).toBe("פורסם 8.11");
  });
  it("says what to do next by stage", () => {
    expect(nextAction(cycle({ status: "approving" }), { ...facts, pendingExemptions: 2 })).toEqual({ text: "לאשר או לדחות 2 פטורים ממתינים", step: "constraints" });
    expect(nextAction(cycle({ status: "slots" }), facts).step).toBe("slots");
    expect(nextAction(cycle({ status: "review" }), { ...facts, slots: 5, job: { status: "done", unfilled: 0 } }).text).toBe("לעבור על הטיוטה ולפרסם");
  });
  it("opens on the cycle with a draft in work", () => {
    const cs = [cycle({ id: "a", status: "published", start_date: "2026-07-01" }), cycle({ id: "b", status: "review" })];
    expect(defaultCycle(cs, "2026-11-08")?.id).toBe("b");
  });
});
