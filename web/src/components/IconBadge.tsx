import { Box, Paper, Stack, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { ReactNode } from "react";

/** The palette colors an icon badge can take – one meaning each, the same everywhere (2.73). */
export type BadgeTone = "primary" | "secondary" | "info" | "success" | "warning" | "error";

/**
 * The colors' meanings, so a screen picks by meaning and the app stays consistent:
 * חובה info · קבע secondary · פטור success · היעדרות info · חסימה primary · מטווח/שגיאה error ·
 * ממתין warning.
 */
export const TONE = {
  mandatory: "info",
  career: "secondary",
  exemption: "success",
  absence: "info",
  block: "primary",
  range: "error",
  pending: "warning",
} as const satisfies Record<string, BadgeTone>;

/** A small rounded square in a soft tint of its color, the icon in the color itself. */
export function IconBadge({ icon, tone, size = 32 }: { icon: ReactNode; tone: BadgeTone; size?: number }) {
  return (
    <Box
      aria-hidden
      sx={(t) => ({
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: size >= 40 ? 2.5 : 2,
        display: "grid",
        placeItems: "center",
        color: t.palette[tone].main,
        bgcolor: alpha(t.palette[tone].main, 0.16),
        "& svg": { fontSize: Math.round(size * 0.58) },
      })}
    >
      {icon}
    </Box>
  );
}

/** A card with an icon badge beside its title. */
export function IconSection(props: { title: ReactNode; icon: ReactNode; tone: BadgeTone; action?: ReactNode; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1.25, mb: 0.5, flexWrap: "wrap", rowGap: 1 }}>
        <IconBadge icon={props.icon} tone={props.tone} />
        <Typography variant="h3" sx={{ fontSize: 16, fontWeight: 700, flex: 1, minWidth: 0 }}>
          {props.title}
        </Typography>
        {props.action}
      </Stack>
      {props.children}
    </Paper>
  );
}
