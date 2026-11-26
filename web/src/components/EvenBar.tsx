import { Box, Stack } from "@mui/material";
import type { ReactNode } from "react";

export type EvenItem = ReactNode | { node: ReactNode; wide: true };
const isWide = (i: EvenItem): i is { node: ReactNode; wide: true } => !!i && typeof i === "object" && "wide" in i;

/**
 * A row of buttons and filters. Wide screens: one flowing row. Phones: two even columns – every
 * control fills its cell at one height; a `{ node, wide: true }` item spans the row.
 */
export function EvenBar({ narrow, items, chips }: { narrow: boolean; items: EvenItem[]; chips?: boolean }) {
  const shown = items.filter((i) => (isWide(i) ? i.node : i) !== null && (isWide(i) ? i.node : i) !== undefined && (isWide(i) ? i.node : i) !== false);
  if (!narrow)
    return (
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
        {shown.map((i, k) => (
          <Box key={k} sx={{ display: "contents" }}>
            {isWide(i) ? i.node : i}
          </Box>
        ))}
      </Stack>
    );
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 1,
        "& > div": { minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center" },
        "& .MuiTextField-root, & .MuiButton-root, & .MuiChip-root": { width: "100%", minWidth: 0, m: 0 },
        "& .MuiButton-root": { minHeight: 40 },
        "& .MuiChip-root": chips
          ? { height: "auto", minHeight: 36, py: 0.5, "& .MuiChip-label": { whiteSpace: "normal", textAlign: "center" } }
          : { height: 40 },
        "& .MuiFormControlLabel-root": { m: 0 },
      }}
    >
      {shown.map((i, k) => (
        <Box key={k} sx={isWide(i) ? { gridColumn: "1 / -1" } : undefined}>
          {isWide(i) ? i.node : i}
        </Box>
      ))}
    </Box>
  );
}
