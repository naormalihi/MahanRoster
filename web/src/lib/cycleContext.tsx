/**
 * The cycle נע"ת works on, chosen once for the whole app (header switcher) instead of on
 * every screen – so a step is never done on the wrong cycle by mistake.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { canRead, isStaff } from "./api";
import { useAuth } from "./auth";
import { planningCycle, type Cycle } from "./cycles";
import { RETURN_EVENT } from "./refreshOnReturn";
import { dayKey } from "./dates";

const KEY = "mahan.cycle";

interface CycleState {
  cycles: Cycle[] | null;
  cycleId: string;
  cycle: Cycle | undefined;
  setCycleId: (id: string) => void;
  reload: () => Promise<void>;
  /** Published or closed: the planning steps are read-only. */
  locked: boolean;
}

const Ctx = createContext<CycleState | null>(null);

const stored = () => {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
};

/** The cycle to show when nothing was chosen: one with a draft in work, else the one being planned. */
export function defaultCycle(cycles: Cycle[], today: string): Cycle | undefined {
  return cycles.find((c) => c.status === "review" || c.status === "scheduling") ?? planningCycle(cycles, today) ?? cycles[0];
}

export function CycleProvider({ children }: { children: ReactNode }) {
  const { api, me } = useAuth();
  const staff = canRead(me);
  const [cycles, setCycles] = useState<Cycle[] | null>(null);
  const [cycleId, setId] = useState(stored);
  const { pathname } = useLocation();

  const reload = useCallback(async () => {
    if (!staff) return;
    // the stage follows the facts: let it catch up before reading (staff only; readers just read)
    if (isStaff(me)) await api!.refreshCycleStages().catch(() => 0);
    const c = await api!.cycles();
    setCycles(c);
    setId((id) => (c.some((x) => x.id === id) ? id : defaultCycle(c, dayKey(new Date()))?.id ?? ""));
  }, [api, staff, me]);

  // a stage can change on any screen (publish, a new run): refresh on navigation, and when the
  // app comes back to the screen after a while
  useEffect(() => {
    reload().catch(() => setCycles((c) => c ?? []));
  }, [reload, pathname]);
  useEffect(() => {
    const on = () => void reload().catch(() => undefined);
    window.addEventListener(RETURN_EVENT, on);
    return () => window.removeEventListener(RETURN_EVENT, on);
  }, [reload]);

  const setCycleId = useCallback((id: string) => {
    setId(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* private mode: the choice lasts for this visit */
    }
  }, []);

  const value = useMemo<CycleState>(() => {
    const cycle = cycles?.find((c) => c.id === cycleId);
    return { cycles, cycleId, cycle, setCycleId, reload, locked: !!cycle && (cycle.status === "published" || cycle.status === "closed") };
  }, [cycles, cycleId, setCycleId, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCycle(): CycleState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCycle outside CycleProvider");
  return v;
}
