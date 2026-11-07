import PrintIcon from "@mui/icons-material/PrintOutlined";
import SearchIcon from "@mui/icons-material/Search";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import type { BoardRow } from "../lib/api";
import { useAuth } from "../lib/auth";
import { addDays, dayKey, dayLabel, spanLabel, startOfDay, timeLabel, upcomingWeekend, weekOf } from "../lib/dates";

type Range = "week" | "next" | "weekend" | "month";

function rangeOf(r: Range): [Date, Date] {
  const [sun] = weekOf();
  if (r === "week") return [sun, addDays(sun, 7)];
  if (r === "next") return [addDays(sun, 7), addDays(sun, 14)];
  if (r === "weekend") return upcomingWeekend();
  const today = startOfDay(new Date());
  return [today, addDays(today, 31)];
}

function Names({ names, query }: { names: string[]; query: string }) {
  if (!names.length) return <Typography component="span" color="text.disabled">—</Typography>;
  return (
    <>
      {names.map((n, i) => {
        const hit = query && n.includes(query);
        return (
          <Box component="span" key={i} sx={hit ? { bgcolor: "#ffe58a", borderRadius: 0.5, px: 0.3 } : undefined}>
            {n}
            {i < names.length - 1 ? ", " : ""}
          </Box>
        );
      })}
    </>
  );
}

export function BoardPage() {
  const { api } = useAuth();
  const [range, setRange] = useState<Range>("week");
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [gaf, setGaf] = useState("");
  const [category, setCategory] = useState("");

  useEffect(() => {
    const [from, to] = rangeOf(range);
    setRows(null);
    api!
      .board(from.toISOString(), to.toISOString())
      .then(setRows)
      .catch((e) => setError((e as Error).message));
  }, [api, range]);

  const gafim = useMemo(() => [...new Set((rows ?? []).flatMap((r) => r.gafim))].sort(), [rows]);
  const categories = useMemo(() => [...new Set((rows ?? []).map((r) => r.category_name ?? ""))].filter(Boolean).sort(), [rows]);

  const q = query.trim();
  const shown = (rows ?? []).filter(
    (r) =>
      (!gaf || r.gafim.includes(gaf)) &&
      (!category || r.category_name === category) &&
      (!q || r.performers.some((n) => n.includes(q)) || r.reserves.some((n) => n.includes(q))),
  );
  const byDay = new Map<string, BoardRow[]>();
  for (const r of shown) {
    const k = dayKey(r.starts_at);
    byDay.set(k, [...(byDay.get(k) ?? []), r]);
  }

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
        <Typography variant="h1" sx={{ flex: 1 }}>
          לוח התורנויות
        </Typography>
        <Button variant="outlined" startIcon={<PrintIcon />} onClick={() => window.print()} sx={{ "@media print": { display: "none" } }}>
          הדפסה
        </Button>
      </Stack>

      <Paper sx={{ p: 2, "@media print": { display: "none" } }}>
        <Stack spacing={1.5}>
          <ToggleButtonGroup
            value={range}
            exclusive
            onChange={(_, v) => v && setRange(v)}
            size="small"
            sx={{ flexWrap: "wrap" }}
          >
            <ToggleButton value="week">השבוע</ToggleButton>
            <ToggleButton value="next">שבוע הבא</ToggleButton>
            <ToggleButton value="weekend">הסופ"ש הקרוב</ToggleButton>
            <ToggleButton value="month">30 יום</ToggleButton>
          </ToggleButtonGroup>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <TextField
              placeholder="חיפוש לפי שם"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              sx={{ flex: 2 }}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
            />
            <TextField select label="גף" value={gaf} onChange={(e) => setGaf(e.target.value)} sx={{ flex: 1, minWidth: 140 }}>
              <MenuItem value="">כל הגפים</MenuItem>
              {gafim.map((g) => (
                <MenuItem key={g} value={g}>{g}</MenuItem>
              ))}
            </TextField>
            <TextField select label="סוג" value={category} onChange={(e) => setCategory(e.target.value)} sx={{ flex: 1, minWidth: 140 }}>
              <MenuItem value="">כל הסוגים</MenuItem>
              {categories.map((c) => (
                <MenuItem key={c} value={c}>{c}</MenuItem>
              ))}
            </TextField>
          </Stack>
        </Stack>
      </Paper>

      {error && <Alert severity="error">{error}</Alert>}
      {!rows && !error && (
        <Box sx={{ display: "grid", placeItems: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      )}
      {rows && shown.length === 0 && (
        <Alert severity="info">{rows.length ? "אין תורנויות שמתאימות לסינון." : "אין תורנויות מפורסמות בטווח הזה."}</Alert>
      )}

      {[...byDay.entries()].map(([day, items]) => (
        <Box key={day} sx={{ breakInside: "avoid" }}>
          <Typography variant="h3" sx={{ mb: 1, color: "primary.main" }}>
            {dayLabel(items[0].starts_at)}
          </Typography>
          <Stack spacing={1}>
            {items.map((r) => (
              <Paper key={r.slot_id} sx={{ p: 1.5, borderInlineStart: `4px solid ${r.color ?? "#999"}` }}>
                <Stack direction={{ xs: "column", md: "row" }} spacing={{ xs: 0.75, md: 2 }} sx={{ alignItems: { md: "center" } }}>
                  <Box sx={{ minWidth: 190 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      <Typography sx={{ fontWeight: 700 }}>{r.task_name}</Typography>
                      {r.changed_after_publish && <Chip size="small" color="warning" label="עודכן" />}
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ direction: "rtl" }}>
                      {spanLabel(r.starts_at, r.ends_at)}
                    </Typography>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2">
                      <b>מבצע: </b>
                      <Names names={r.performers} query={q} />
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      <b>עתודה: </b>
                      <Names names={r.reserves} query={q} />
                    </Typography>
                  </Box>
                  <Box sx={{ minWidth: 170 }}>
                    {r.gafim.length > 0 && <Typography variant="body2">{r.gafim.join(", ")}</Typography>}
                    {r.report_at && (
                      <Typography variant="caption" color="text.secondary">
                        התייצבות {timeLabel(r.report_at)}
                        {r.report_place ? ` · ${r.report_place}` : ""}
                      </Typography>
                    )}
                    {r.instructions && (
                      <Typography variant="caption" color="text.secondary" component="div" sx={{ whiteSpace: "pre-line", maxWidth: 320 }}>
                        {r.instructions}
                      </Typography>
                    )}
                  </Box>
                </Stack>
              </Paper>
            ))}
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}
