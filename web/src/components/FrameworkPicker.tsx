import ExpandIcon from "@mui/icons-material/ExpandMore";
import CollapseIcon from "@mui/icons-material/ChevronLeft";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  IconButton,
  InputAdornment,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { useMemo, useState } from "react";
import {
  countSelected,
  isNewTop,
  isSelected,
  setAll,
  toggleGaf,
  toggleTop,
  topState,
  type FrameworkSelection,
  type TreeNode,
} from "../lib/frameworks";

/** "מסגרות לטעינה" – the frameworks of the file, the top ones and the gafim under them. */
export function FrameworkPicker({
  tree,
  sel,
  setSel,
  busy,
  onBack,
  onNext,
}: {
  tree: TreeNode[];
  sel: FrameworkSelection;
  setSel: (s: FrameworkSelection) => void;
  busy: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const [q, setQ] = useState("");
  // a single top (a file with a gaf column only, or one framework) opens by itself
  const [open, setOpen] = useState<Set<string>>(() => new Set(tree.length <= 2 ? tree.map((t) => t.top) : []));
  const total = tree.reduce((n, t) => n + t.count, 0);
  const chosen = countSelected(sel, tree);
  const shown = useMemo(() => {
    const s = q.trim();
    if (!s) return tree;
    return tree
      .map((t) => (t.top.includes(s) ? t : { ...t, gafim: t.gafim.filter((g) => (g.gaf ?? "ישירות תחת המסגרת").includes(s)) }))
      .filter((t) => t.top.includes(s) || t.gafim.length > 0);
  }, [tree, q]);
  const flip = (top: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(top)) next.delete(top);
      else next.add(top);
      return next;
    });

  return (
    <Paper sx={{ p: 3 }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h3">מסגרות לטעינה</Typography>
          <Typography variant="body2" color="text.secondary">
            רק רשומות מהמסגרות המסומנות ייטענו. הבחירה נשמרת לטעינה הבאה; מסגרת חדשה תחת מסגרת עליונה שמסומנת כולה תיכנס מעצמה.
          </Typography>
        </Box>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
          <Chip color={chosen ? "primary" : "default"} label={`נבחרו ${chosen} מתוך ${total} רשומות`} />
          <TextField
            size="small"
            placeholder="חיפוש מסגרת"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
            sx={{ flex: 1, maxWidth: 320 }}
          />
          <Stack direction="row" spacing={1}>
            <Button size="small" onClick={() => setSel(setAll(sel, tree, true))}>סמן הכל</Button>
            <Button size="small" onClick={() => setSel(setAll(sel, tree, false))}>נקה הכל</Button>
          </Stack>
        </Stack>

        <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, maxHeight: 480, overflowY: "auto" }}>
          {shown.map((t) => {
            const full = tree.find((x) => x.top === t.top)!;
            const state = topState(sel, full);
            const isOpen = open.has(t.top) || q.trim() !== "";
            const single = t.top === "";
            return (
              <Box key={t.top} sx={{ borderBottom: 1, borderColor: "divider", "&:last-of-type": { borderBottom: 0 } }}>
                {!single && (
                  <Stack direction="row" sx={{ alignItems: "center", px: 0.5, bgcolor: "action.hover" }}>
                    <IconButton size="small" onClick={() => flip(t.top)} aria-label={isOpen ? "סגירה" : "פתיחה"}>
                      {isOpen ? <ExpandIcon fontSize="small" /> : <CollapseIcon fontSize="small" />}
                    </IconButton>
                    <Checkbox
                      size="small"
                      checked={state === "all"}
                      indeterminate={state === "some"}
                      onChange={() => setSel(toggleTop(sel, full))}
                    />
                    <Typography sx={{ fontWeight: 700, flex: 1 }} onClick={() => flip(t.top)}>
                      {t.top}
                    </Typography>
                    {isNewTop(sel, t.top) && <Chip size="small" color="warning" label="חדש בקובץ" sx={{ mx: 1 }} />}
                    <Typography variant="body2" color="text.secondary" sx={{ px: 1.5 }}>
                      {full.count}
                    </Typography>
                  </Stack>
                )}
                {(isOpen || single) &&
                  t.gafim.map((g) => (
                    <Stack key={g.gaf ?? ""} direction="row" sx={{ alignItems: "center", pr: single ? 0.5 : 5, pl: 0.5 }}>
                      <Checkbox
                        size="small"
                        checked={isSelected(sel, { top: t.top, gaf: g.gaf })}
                        onChange={() => setSel(toggleGaf(sel, full, g.gaf))}
                      />
                      <Typography sx={{ flex: 1 }} color={g.gaf === null ? "text.secondary" : undefined}>
                        {g.gaf ?? "ישירות תחת המסגרת"}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ px: 1.5 }}>
                        {g.count}
                      </Typography>
                    </Stack>
                  ))}
              </Box>
            );
          })}
          {shown.length === 0 && (
            <Typography color="text.secondary" sx={{ p: 2 }}>
              לא נמצאו מסגרות.
            </Typography>
          )}
        </Box>

        <Stack direction="row" spacing={1.5}>
          <Button variant="contained" onClick={onNext} disabled={busy || chosen === 0}>
            תצוגה מקדימה
          </Button>
          <Button onClick={onBack} disabled={busy}>
            חזרה
          </Button>
        </Stack>
        {busy && <LinearProgress />}
      </Stack>
    </Paper>
  );
}
