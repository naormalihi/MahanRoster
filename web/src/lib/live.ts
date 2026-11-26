import { useEffect, useState } from "react";

/**
 * "רענון חי" (2.65): the server keeps a counter that grows on every change of the unit's data. The
 * layout checks it every 15 seconds while the app is on the screen (and at once on return); when
 * it moved, LIVE_EVENT fires and every open screen loads its data again, quietly – its filters,
 * tab, selection and scroll stay. Not while a dialog is open or a field is being typed in: what is
 * being typed is kept; the screen catches up right after.
 */
export const LIVE_EVENT = "mahanroster:live";

/** A number that grows on each live change – put it in the deps of an effect that loads data. */
export function useLiveTick(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const on = () => setN((x) => x + 1);
    window.addEventListener(LIVE_EVENT, on);
    return () => window.removeEventListener(LIVE_EVENT, on);
  }, []);
  return n;
}

const POLL_MS = 15_000;
/** a dialog is open, or a field is being typed in: wait – the change is shown when it is over */
const busy = () => {
  if (document.querySelector(".MuiDialog-root")) return true;
  const a = document.activeElement as HTMLInputElement | null;
  if (!a) return false;
  if (a.tagName === "TEXTAREA" || a.isContentEditable) return true;
  return a.tagName === "INPUT" && !["checkbox", "radio", "button", "submit"].includes(a.type);
};

/** The layout's poller: checks the server's counter and fires LIVE_EVENT when it moved. */
export function useLivePoller(read: (() => Promise<number>) | null) {
  useEffect(() => {
    if (!read) return;
    let last: number | null = null;
    let pending = false;
    let stopped = false;
    const fire = () => {
      if (busy()) return void (pending = true);
      pending = false;
      window.dispatchEvent(new Event(LIVE_EVENT));
    };
    const check = async () => {
      if (stopped || document.visibilityState !== "visible" || !navigator.onLine) return;
      try {
        const v = await read();
        if (last !== null && v !== last) pending = true;
        last = v;
      } catch {
        return; // no reception or signed out: next time
      }
      if (pending) fire();
    };
    void check();
    const timer = window.setInterval(() => void check(), POLL_MS);
    // a dialog closed while a change waited: catch up soon after
    const soon = window.setInterval(() => pending && !busy() && fire(), 1_500);
    const onShow = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.clearInterval(soon);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, [read]);
}
