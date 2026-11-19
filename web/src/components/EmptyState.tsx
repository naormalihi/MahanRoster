import { Box, Button, Paper, Stack, Typography, alpha } from "@mui/material";
import type { ReactNode } from "react";
import { Mascot, type MascotPose } from "./Mascot";

/**
 * A screen or a section with nothing to show yet: Turanchik, one line, and the next thing to do.
 * "sm" for a section inside a busy screen, "md" for a whole screen.
 */
export function EmptyState({
  pose = "clipboard",
  title,
  text,
  action,
  size = "md",
}: {
  pose?: MascotPose;
  title: string;
  text?: ReactNode;
  action?: ReactNode;
  size?: "sm" | "md";
}) {
  const sm = size === "sm";
  return (
    <Paper variant="outlined" sx={{ p: sm ? 1.5 : { xs: 2.5, sm: 3 }, borderStyle: "dashed", bgcolor: (t) => alpha(t.palette.secondary.main, t.palette.mode === "dark" ? 0.06 : 0.05) }}>
      <Stack direction={sm ? "row" : "column"} spacing={sm ? 1.5 : 1} sx={{ alignItems: "center", textAlign: sm ? "start" : "center" }}>
        <Mascot pose={pose} height={sm ? 72 : 130} />
        <Box sx={{ flex: sm ? 1 : undefined, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700 }}>{title}</Typography>
          {text && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {text}
            </Typography>
          )}
          {action && (
            <Box sx={{ mt: 1.25 }}>
              {action}
            </Box>
          )}
        </Box>
      </Stack>
    </Paper>
  );
}

/** A screen that could not load: the confused owl, what happened, and a retry. */
export function ErrorState({ text, onRetry }: { text: string; onRetry?: () => void }) {
  // no reception is not an error of the app: say so, and where the duties still are
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  return (
    <EmptyState
      pose={offline ? "sleep" : "confused"}
      title={offline ? "אין חיבור" : "משהו לא הסתדר"}
      text={offline ? 'המסך הזה צריך חיבור לאינטרנט. "התורנויות שלי" זמינות גם בלי קליטה.' : text}
      action={
        onRetry && (
          <Button variant="contained" size="small" onClick={onRetry}>
            לנסות שוב
          </Button>
        )
      }
    />
  );
}

/** "Good morning" by the hour, in the unit's time zone. */
export function greeting(now = new Date()): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", hour12: false }).format(now));
  if (h >= 5 && h < 12) return "בוקר טוב";
  if (h >= 12 && h < 17) return "צהריים טובים";
  if (h >= 17 && h < 22) return "ערב טוב";
  return "לילה טוב";
}

/** The head icon, gently bobbing while the engine works. */
export function WorkingOwl({ size = 44 }: { size?: number }) {
  return (
    <Box
      component="img"
      src="/brand/owl/head-96.png"
      alt="תורנצ׳יק עובד"
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        animation: "owl-bob 1.6s ease-in-out infinite",
        "@keyframes owl-bob": { "0%,100%": { transform: "rotate(-6deg)" }, "50%": { transform: "rotate(6deg) translateY(-2px)" } },
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
      }}
    />
  );
}
