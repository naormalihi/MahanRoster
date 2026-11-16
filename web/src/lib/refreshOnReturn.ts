import { useEffect, useState } from "react";

/** Fired when the app comes back to the screen after a while – data may have changed. */
export const RETURN_EVENT = "mahanroster:returned";

/** How long away before the screen reloads its data on return. */
const AWAY_MS = 15_000;

/**
 * A counter that grows each time the app returns to the screen after being away (another app,
 * another tab, a locked phone) for a while. The page around it is keyed by it, so every screen
 * loads its data again – no manual refresh. Not while a dialog is open: what is being typed
 * there is kept.
 */
export function useReturnCounter(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let hiddenAt: number | null = document.visibilityState === "hidden" ? Date.now() : null;
    const onChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt !== null && Date.now() - hiddenAt >= AWAY_MS;
      hiddenAt = null;
      if (!away || document.querySelector(".MuiDialog-root")) return;
      window.dispatchEvent(new Event(RETURN_EVENT));
      setN((x) => x + 1);
    };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return n;
}
