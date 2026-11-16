import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppTheme } from "./theme";

// a page of an older version that is no longer on the server: the owl screen in index.html reloads
window.addEventListener("vite:preloadError", (e) => {
  e.preventDefault();
  (window as unknown as { __appUpdate?: () => void }).__appUpdate?.();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppTheme>
      <App />
    </AppTheme>
  </StrictMode>,
);
