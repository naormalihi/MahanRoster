import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import { IconButton, Tooltip } from "@mui/material";
import { useEffect, useRef } from "react";
import { useAuth } from "../lib/auth";
import { isThemeChoice, useThemeMode } from "../theme";

/** On sign-in, the look saved with the account wins over the device's (once per sign-in). */
export function ThemeSync() {
  const { me } = useAuth();
  const { choice, setChoice } = useThemeMode();
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (!me || applied.current === me.userId) return;
    applied.current = me.userId;
    if (isThemeChoice(me.uiTheme) && me.uiTheme !== choice) setChoice(me.uiTheme);
  }, [me, choice, setChoice]);
  return null;
}

/**
 * One button: a moon in day mode (tap for night), a sun in night mode (tap for day).
 * Until tapped the look follows the device; the choice is kept on the device and with the account.
 */
export function ThemeToggle() {
  const { mode, setChoice } = useThemeMode();
  const { api, me } = useAuth();
  const next = mode === "dark" ? "light" : "dark";
  const label = next === "dark" ? "מצב לילה" : "מצב יום";
  return (
    <Tooltip title={label}>
      <IconButton
        color="inherit"
        aria-label={label}
        onClick={() => {
          setChoice(next);
          if (api && me) api.setMyTheme(next).catch(() => {}); // the device keeps it anyway
        }}
      >
        {next === "dark" ? <DarkModeOutlinedIcon /> : <LightModeOutlinedIcon />}
      </IconButton>
    </Tooltip>
  );
}
