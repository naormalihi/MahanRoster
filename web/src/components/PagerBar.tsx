import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Box, IconButton, Menu, MenuItem, Paper, Stack, Typography } from "@mui/material";
import { useState, type ReactNode } from "react";

export interface PagerItem {
  key: string;
  label: string;
  /** the grey line under the label: a state, or what the page is for */
  status?: ReactNode;
  /** the item's dot (a palette path like "success.main"); grey when absent */
  dot?: string;
}

/**
 * Sections on a phone, one line instead of tabs: "step 2 of 5 · name" with its state, arrows to
 * the sections around it, a dot per section, and the line opens the full list. The same look in
 * the cycle steps and in the settings.
 */
export function PagerBar({
  items,
  current,
  onGo,
  title,
  menuLabel = (x) => x.label,
}: {
  items: PagerItem[];
  current: string;
  onGo: (key: string) => void;
  /** the bar's line, e.g. "שלב 2 מתוך 5 · פוטנציאל" */
  title: (item: PagerItem, i: number) => string;
  /** an item in the full list */
  menuLabel?: (item: PagerItem, i: number) => string;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const i = Math.max(0, items.findIndex((x) => x.key === current));
  const cur = items[i];
  const go = (j: number) => j >= 0 && j < items.length && onGo(items[j].key);
  return (
    <Paper variant="outlined" sx={{ px: 0.5, py: 0.75 }}>
      <Stack direction="row" sx={{ alignItems: "center" }}>
        <IconButton data-read aria-label="הקודם" disabled={i <= 0} onClick={() => go(i - 1)}>
          <ChevronRightIcon />
        </IconButton>
        <Box
          data-read
          component="button"
          type="button"
          onClick={(e) => setAnchor(e.currentTarget)}
          aria-label="הצגת הכל"
          sx={{ all: "unset", flex: 1, minWidth: 0, textAlign: "center", cursor: "pointer", borderRadius: 1, py: 0.25, "&:hover": { bgcolor: "action.hover" } }}
        >
          <Typography sx={{ fontWeight: 700, fontSize: 15 }}>
            {title(cur, i)}
            <ExpandMoreIcon sx={{ fontSize: 18, verticalAlign: "middle", color: "text.secondary" }} />
          </Typography>
          {cur.status && <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0.5, fontSize: 12, color: "text.secondary" }}>{cur.status}</Box>}
          <Stack direction="row" spacing={0.75} sx={{ justifyContent: "center", mt: 0.75 }}>
            {items.map((x, j) => (
              <Box
                key={x.key}
                sx={{ width: j === i ? 18 : 7, height: 7, borderRadius: 4, transition: "width .2s", bgcolor: j === i ? "primary.main" : (x.dot ?? "grey.300") }}
              />
            ))}
          </Stack>
        </Box>
        <IconButton data-read aria-label="הבא" disabled={i >= items.length - 1} onClick={() => go(i + 1)}>
          <ChevronLeftIcon />
        </IconButton>
      </Stack>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} slotProps={{ paper: { sx: { minWidth: 260 } } }}>
        {items.map((x, j) => (
          <MenuItem
            key={x.key}
            selected={x.key === cur.key}
            onClick={() => {
              setAnchor(null);
              onGo(x.key);
            }}
          >
            <Box>
              <Typography sx={{ fontWeight: 700, fontSize: 14 }}>{menuLabel(x, j)}</Typography>
              {x.status && <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, fontSize: 12, color: "text.secondary" }}>{x.status}</Box>}
            </Box>
          </MenuItem>
        ))}
      </Menu>
    </Paper>
  );
}
