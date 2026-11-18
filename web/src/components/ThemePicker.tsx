import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import SettingsBrightnessIcon from "@mui/icons-material/SettingsBrightness";
import { Box, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { THEME_CHOICES, isThemeChoice, useThemeMode, type ThemeChoice } from "../theme";

const ICON: Record<ThemeChoice, typeof DarkModeIcon> = { light: LightModeIcon, dark: DarkModeIcon, auto: SettingsBrightnessIcon };

/** Change the look, and keep it with the account too (so another device follows). */
function useChoose() {
  const { choice, setChoice } = useThemeMode();
  const { api, me } = useAuth();
  return {
    choice,
    choose: (c: ThemeChoice) => {
      setChoice(c);
      if (api && me) api.setMyTheme(c).catch(() => {}); // the device keeps it anyway
    },
  };
}

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

/** An icon in the top bar that opens the three choices. */
export function ThemeMenuButton() {
  const { choice, choose } = useChoose();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const Icon = ICON[choice];
  return (
    <>
      <IconButton color="inherit" aria-label="מראה" title="מראה: בהיר / כהה" onClick={(e) => setAnchor(e.currentTarget)}>
        <Icon />
      </IconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {THEME_CHOICES.map((c) => {
          const I = ICON[c.value];
          return (
            <MenuItem
              key={c.value}
              selected={c.value === choice}
              onClick={() => {
                choose(c.value);
                setAnchor(null);
              }}
            >
              <ListItemIcon>
                <I fontSize="small" />
              </ListItemIcon>
              <ListItemText primary={c.label} />
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}

/** A row of three buttons (the side menu). */
export function ThemeToggleRow() {
  const { choice, choose } = useChoose();
  return (
    <Box sx={{ px: 2, py: 1.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
        מראה
      </Typography>
      <ToggleButtonGroup size="small" exclusive fullWidth value={choice} onChange={(_, v) => isThemeChoice(v) && choose(v)}>
        {THEME_CHOICES.map((c) => {
          const I = ICON[c.value];
          return (
            <ToggleButton key={c.value} value={c.value} sx={{ gap: 0.5 }}>
              <I fontSize="small" />
              {c.label}
            </ToggleButton>
          );
        })}
      </ToggleButtonGroup>
    </Box>
  );
}
