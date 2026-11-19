import createCache from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import { CssBaseline, ThemeProvider, createTheme, useMediaQuery } from "@mui/material";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { prefixer } from "stylis";
import rtlPlugin from "stylis-plugin-rtl";

const rtlCache = createCache({ key: "muirtl", stylisPlugins: [prefixer, rtlPlugin] });

/** The look the user chose: light, dark, or as the device is set. */
export type ThemeChoice = "auto" | "light" | "dark";

const STORAGE_KEY = "mr.theme";
const NAVY = "#1a1466";
const ORANGE = "#e8700f";

export function isThemeChoice(v: unknown): v is ThemeChoice {
  return v === "auto" || v === "light" || v === "dark";
}

function readStored(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isThemeChoice(v) ? v : "auto";
  } catch {
    return "auto";
  }
}

function makeTheme(mode: "light" | "dark") {
  const dark = mode === "dark";
  return createTheme({
    direction: "rtl",
    palette: {
      mode,
      // the brand: deep navy and orange; on a dark background the navy is lightened to stay readable
      primary: dark ? { main: "#9f98ff", contrastText: "#0d0b2b" } : { main: NAVY },
      secondary: { main: ORANGE },
      background: dark ? { default: "#0f1117", paper: "#171a22" } : { default: "#f4f5f7", paper: "#ffffff" },
    },
    shape: { borderRadius: 10 },
    typography: {
      fontFamily: "Assistant, 'Segoe UI', Arial, sans-serif",
      h1: { fontSize: "1.6rem", fontWeight: 700 },
      h2: { fontSize: "1.25rem", fontWeight: 700 },
      h3: { fontSize: "1.05rem", fontWeight: 600 },
      button: { fontWeight: 600 },
    },
    components: {
      MuiButton: { defaultProps: { disableElevation: true } },
      MuiPaper: { defaultProps: { variant: "outlined" } },
      MuiTextField: { defaultProps: { size: "small" } },
      // the top bar keeps the brand navy in both modes
      MuiAppBar: { styleOverrides: { colorPrimary: dark ? { backgroundColor: "#1b1840", color: "#fff" } : {} } },
      MuiCssBaseline: { styleOverrides: { "@media print": { body: { backgroundColor: "#fff", color: "#000" } } } },
    },
  });
}

interface ThemeModeValue {
  /** what the user chose */
  choice: ThemeChoice;
  /** what is shown now */
  mode: "light" | "dark";
  /** change the look; saved on this device */
  setChoice: (c: ThemeChoice) => void;
}

const ThemeModeContext = createContext<ThemeModeValue>({ choice: "auto", mode: "light", setChoice: () => {} });
export const useThemeMode = () => useContext(ThemeModeContext);

export function AppTheme({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(readStored);
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)", { noSsr: true });
  // printing is always light
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  const mode: "light" | "dark" = printing ? "light" : choice === "auto" ? (prefersDark ? "dark" : "light") : choice;
  const theme = useMemo(() => makeTheme(mode), [mode]);

  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mode === "dark" ? "#0f1117" : NAVY);
    document.documentElement.style.colorScheme = mode;
  }, [mode]);

  const setChoice = useCallback((c: ThemeChoice) => {
    setChoiceState(c);
    try {
      localStorage.setItem(STORAGE_KEY, c);
    } catch {
      /* private mode: the choice lasts this visit */
    }
  }, []);

  const value = useMemo(() => ({ choice, mode, setChoice }), [choice, mode, setChoice]);
  return (
    <CacheProvider value={rtlCache}>
      <ThemeModeContext.Provider value={value}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          {children}
        </ThemeProvider>
      </ThemeModeContext.Provider>
    </CacheProvider>
  );
}
