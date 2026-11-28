import { Box, Paper, Stack, Typography, useMediaQuery, useTheme } from "@mui/material";
import type { ReactNode } from "react";

/** Phones get cards instead of a wide table (the table stays on a wider screen). */
export function useNarrow(): boolean {
  return useMediaQuery(useTheme().breakpoints.down("sm"));
}

/** The cards, one under the other, in one frame. */
export function CardList({ children }: { children: ReactNode }) {
  return (
    <Paper variant="outlined">
      <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>{children}</Stack>
    </Paper>
  );
}

/**
 * One row as a card: a title with chips beside it, a line under it, more lines in grey, and the
 * row's buttons at the bottom. A card with onClick opens the row.
 */
export function RowCard({
  title,
  chips,
  sub,
  lines,
  actions,
  tools,
  lead,
  onClick,
  dim,
}: {
  title: ReactNode;
  chips?: ReactNode;
  sub?: ReactNode;
  lines?: ReactNode[];
  actions?: ReactNode;
  /** icon buttons – on the far side of the actions' row */
  tools?: ReactNode;
  lead?: ReactNode;
  onClick?: () => void;
  dim?: boolean;
}) {
  return (
    <Box
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
      sx={{ px: 1.5, py: 1.25, opacity: dim ? 0.55 : 1, cursor: onClick ? "pointer" : undefined, "&:hover": onClick ? { bgcolor: "action.hover" } : undefined }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
        {lead}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" sx={{ alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
            <Typography component="div" sx={{ fontWeight: 700 }}>{title}</Typography>
            {chips}
          </Stack>
          {sub && (
            <Typography variant="body2" sx={{ mt: 0.25 }}>
              {sub}
            </Typography>
          )}
          {lines?.filter(Boolean).map((l, i) => (
            <Typography key={i} variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {l}
            </Typography>
          ))}
          {(actions || tools) && (
            <Stack
              direction="row"
              sx={{ gap: 1, mt: 1, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}
              onClick={(e) => e.stopPropagation()}
            >
              <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap", "& .MuiButton-root": { minWidth: 92 } }}>
                {actions}
              </Stack>
              {tools && (
                <Stack direction="row" sx={{ gap: 0.5, ms: "auto" }}>
                  {tools}
                </Stack>
              )}
            </Stack>
          )}
        </Box>
      </Stack>
    </Box>
  );
}
