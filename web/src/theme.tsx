import createCache from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import type { ReactNode } from "react";
import { prefixer } from "stylis";
import rtlPlugin from "stylis-plugin-rtl";

const rtlCache = createCache({ key: "muirtl", stylisPlugins: [prefixer, rtlPlugin] });

const theme = createTheme({
  direction: "rtl",
  palette: {
    mode: "light",
    // the unit emblem: deep navy and orange
    primary: { main: "#1a1466" },
    secondary: { main: "#e8700f" },
    background: { default: "#f4f5f7", paper: "#ffffff" },
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
  },
});

export function AppTheme({ children }: { children: ReactNode }) {
  return (
    <CacheProvider value={rtlCache}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </CacheProvider>
  );
}
