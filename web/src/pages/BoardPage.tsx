import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import InfoIcon from "@mui/icons-material/InfoOutlined";
import PrintIcon from "@mui/icons-material/PrintOutlined";
import SearchIcon from "@mui/icons-material/Search";
import TuneIcon from "@mui/icons-material/Tune";
import {
  Alert,
  Badge,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { BoardRow } from "../lib/api";
import { useAuth } from "../lib/auth";
import { groupByDay, isWeekend, mentions, people, span, type Person } from "../lib/board";
import { addDays, dayKey, dayLabel, timeLabel, upcomingWeekend, weekOf } from "../lib/dates";

type Range = "week" | "next" | "weekend" | "month";

const monthFmt = new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" });
const weekdayFmt = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", weekday: "long" });
const dateFmt = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric" });

/** First day of a month, local midnight. */
const monthStartOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

function rangeOf(r: Range, month: Date): [Date, Date] {
  const [sun] = weekOf();
  if (r === "week") return [sun, addDays(sun, 7)];
  if (r === "next") return [addDays(sun, 7), addDays(sun, 14)];
  if (r === "weekend") return upcomingWeekend();
  return [month, new Date(month.getFullYear(), month.getMonth() + 1, 1)];
}

function Name({ p, query, strong }: { p: Person; query: string; strong?: boolean }) {
  const hit = !!query && p.name.includes(query);
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "baseline", gap: 0.75, flexWrap: "wrap" }}>
      <Box
        component="span"
        sx={{ fontWeight: strong ? 700 : 500, ...(hit ? { bgcolor: "#ffe58a", color: "#000", borderRadius: 0.5, px: 0.4 } : null) }}
      >
        {p.name}
      </Box>
      {p.gaf && (
        <Box component="span" sx={{ fontSize: 12, color: "text.secondary" }}>
          {p.gaf}
        </Box>
      )}
    </Box>
  );
}

function People({ list, query, strong, empty }: { list: Person[]; query: string; strong?: boolean; empty: React.ReactNode }) {
  if (!list.length) return <>{empty}</>;
  return (
    <Stack spacing={0.25}>
      {list.map((p, i) => (
        <Name key={i} p={p} query={query} strong={strong} />
      ))}
    </Stack>
  );
}

function DutyRow({ r, query }: { r: BoardRow; query: string }) {
  const [open, setOpen] = useState(false);
  const t = span(r.starts_at, r.ends_at);
  const performers = people(r.performers, r.performer_gafim ?? (r.gafim.length === 1 ? r.performers.map(() => r.gafim[0]) : undefined));
  const reserves = people(r.reserves, r.reserve_gafim);
  const details = !!(r.instructions || r.report_at || r.briefing_at);
  const unstaffed = performers.length === 0;

  const time = (
    <Box sx={{ fontVariantNumeric: "tabular-nums", color: "text.secondary", fontSize: 13 }}>
      {t.from} עד {t.until && t.until !== "למחרת" ? `${t.until}, ` : ""}
      {t.to}
      {t.until === "למחרת" ? " למחרת" : ""}
    </Box>
  );

  return (
    <Box sx={{ position: "relative", pr: 1.75, pl: 1, py: 1.25, bgcolor: unstaffed ? "rgba(211,47,47,0.04)" : undefined }}>
      <Box sx={{ position: "absolute", insetInlineStart: 0, top: 8, bottom: 8, width: 4, borderRadius: 2, bgcolor: r.color ?? "grey.400" }} />
      <Box
        sx={{
          display: "grid",
          gap: { xs: 0.75, md: 2 },
          alignItems: "start",
          gridTemplateColumns: { xs: "1fr auto", md: "minmax(170px, 1.1fr) minmax(160px, 1.3fr) minmax(140px, 1fr) auto" },
          gridTemplateAreas: { xs: `"duty info" "perf perf" "res res"`, md: `"duty perf res info"` },
        }}
      >
        <Box sx={{ gridArea: "duty", minWidth: 0 }}>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Typography sx={{ fontWeight: 700, lineHeight: 1.3 }}>{r.task_name}</Typography>
            {r.changed_after_publish && <Chip size="small" color="warning" label="עודכן" sx={{ height: 20 }} />}
          </Stack>
          {time}
        </Box>
        <Box sx={{ gridArea: "perf", minWidth: 0 }}>
          <People
            list={performers}
            query={query}
            strong
            empty={
              <Typography component="span" color="error" sx={{ fontWeight: 700 }}>
                לא מאויש
              </Typography>
            }
          />
        </Box>
        <Box sx={{ gridArea: "res", minWidth: 0, display: "flex", gap: 0.75, alignItems: "baseline", fontSize: 14, color: "text.secondary" }}>
          <Box component="span" sx={{ fontSize: 12, flexShrink: 0 }}>
            עתודה
          </Box>
          <People list={reserves} query={query} empty={<span>—</span>} />
        </Box>
        <Box sx={{ gridArea: "info", "@media print": { display: "none" } }}>
          {details && (
            <IconButton size="small" aria-label={open ? "הסתרת הנחיות" : "הנחיות"} aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? <ExpandLessIcon fontSize="small" /> : <InfoIcon fontSize="small" />}
            </IconButton>
          )}
        </Box>
      </Box>
      {details && (
        <Collapse in={open} sx={{ "@media print": { display: "block !important", height: "auto !important", visibility: "visible !important" } }}>
          <Box sx={{ mt: 1, p: 1.25, borderRadius: 1, bgcolor: "action.hover", fontSize: 13 }}>
            {(r.report_at || r.briefing_at) && (
              <Stack direction="row" spacing={1} sx={{ mb: r.instructions ? 0.75 : 0, flexWrap: "wrap", gap: 0.5 }}>
                {r.report_at && <Chip size="small" variant="outlined" label={`התייצבות ${timeLabel(r.report_at)}${r.report_place ? ` · ${r.report_place}` : ""}`} />}
                {r.briefing_at && (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`תדריך ${dayKey(r.briefing_at) === dayKey(r.starts_at) ? "" : `${dateFmt.format(new Date(r.briefing_at))} `}${timeLabel(r.briefing_at)}${r.briefing_place ? ` · ${r.briefing_place}` : ""}`}
                  />
                )}
              </Stack>
            )}
            {r.instructions && <Box sx={{ whiteSpace: "pre-line", lineHeight: 1.6 }}>{r.instructions}</Box>}
          </Box>
        </Collapse>
      )}
    </Box>
  );
}

function DayHeader({ day, count }: { day: string; count: number }) {
  const today = day === dayKey(new Date());
  const d = new Date(day + "T12:00:00");
  return (
    <Box
      sx={{
        position: "sticky",
        top: { xs: 56, sm: 64 },
        zIndex: 2,
        bgcolor: "background.default",
        py: 0.75,
        display: "flex",
        alignItems: "baseline",
        gap: 1,
        "@media print": { position: "static" },
      }}
    >
      <Typography sx={{ fontWeight: 800, fontSize: 17, color: today ? "secondary.main" : "primary.main" }}>{weekdayFmt.format(d)}</Typography>
      <Typography sx={{ fontWeight: 600, color: "text.secondary" }}>{dateFmt.format(d)}</Typography>
      {today && <Chip size="small" color="secondary" label="היום" sx={{ height: 20 }} />}
      {isWeekend(day) && !today && <Chip size="small" variant="outlined" label="סופ״ש" sx={{ height: 20 }} />}
      <Box sx={{ flex: 1 }} />
      <Typography variant="caption" color="text.secondary">
        {count} תורנויות
      </Typography>
    </Box>
  );
}

export function BoardPage() {
  const { api } = useAuth();
  const [range, setRange] = useState<Range>("week");
  const [month, setMonth] = useState<Date>(() => monthStartOf(new Date()));
  const [next, setNext] = useState<string | null>(null);
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [gaf, setGaf] = useState("");
  const [category, setCategory] = useState("");
  const [filters, setFilters] = useState(false);

  useEffect(() => {
    const [from, to] = rangeOf(range, month);
    setRows(null);
    setNext(null);
    api!
      .board(from.toISOString(), to.toISOString())
      .then((r) => {
        setRows(r);
        // nothing here: offer the next published date (a cycle is published about two months ahead)
        if (!r.length) api!.nextPublished(to.toISOString()).then(setNext).catch(() => setNext(null));
      })
      .catch((e) => setError((e as Error).message));
  }, [api, range, month]);

  const jumpTo = (iso: string) => {
    setMonth(monthStartOf(new Date(iso)));
    setRange("month");
  };

  const gafOf = (r: BoardRow) => people(r.performers, r.performer_gafim ?? r.gafim).map((p) => p.gaf).filter(Boolean);
  const gafim = useMemo(() => [...new Set((rows ?? []).flatMap(gafOf))].sort((a, b) => a.localeCompare(b, "he")), [rows]);
  const categories = useMemo(() => [...new Set((rows ?? []).map((r) => r.category_name ?? ""))].filter(Boolean).sort(), [rows]);

  const q = query.trim();
  const shown = (rows ?? []).filter((r) => (!gaf || gafOf(r).includes(gaf)) && (!category || r.category_name === category) && mentions(r, q));
  const days = groupByDay(shown);
  const unstaffed = shown.filter((r) => !r.performers.length).length;
  const active = (gaf ? 1 : 0) + (category ? 1 : 0);
  const [from, to] = rangeOf(range, month);
  const title =
    range === "month" ? monthFmt.format(month) : `${dateFmt.format(from)} – ${dateFmt.format(addDays(to, -1))}`;

  return (
    <Stack spacing={1.5} sx={{ maxWidth: 1100, mx: "auto", width: "100%" }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h1">לוח התורנויות</Typography>
          <Typography variant="body2" color="text.secondary">
            {title}
            {rows && ` · ${shown.length} תורנויות`}
            {unstaffed > 0 && (
              <Box component="span" sx={{ color: "error.main", fontWeight: 600 }}>
                {` · ${unstaffed} לא מאוישות`}
              </Box>
            )}
          </Typography>
        </Box>
        <IconButton aria-label="הדפסה" onClick={() => window.print()} sx={{ display: { sm: "none" }, "@media print": { display: "none" } }}>
          <PrintIcon />
        </IconButton>
        <Button
          variant="outlined"
          startIcon={<PrintIcon />}
          onClick={() => window.print()}
          sx={{ display: { xs: "none", sm: "inline-flex" }, "@media print": { display: "none" } }}
        >
          הדפסה
        </Button>
      </Stack>

      <Paper variant="outlined" sx={{ p: 1.25, "@media print": { display: "none" } }}>
        <Stack spacing={1.25}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
            <ToggleButtonGroup
              value={range}
              exclusive
              onChange={(_, v) => v && setRange(v)}
              size="small"
              sx={{ "& .MuiToggleButton-root": { px: 1.25, py: 0.5 } }}
            >
              <ToggleButton value="week">השבוע</ToggleButton>
              <ToggleButton value="next">הבא</ToggleButton>
              <ToggleButton value="weekend">סופ"ש</ToggleButton>
              <ToggleButton value="month">חודש</ToggleButton>
            </ToggleButtonGroup>
            {range === "month" && (
              <Stack direction="row" sx={{ alignItems: "center" }}>
                <IconButton size="small" aria-label="החודש הקודם" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
                  <ChevronRightIcon />
                </IconButton>
                <Typography sx={{ minWidth: 104, textAlign: "center", fontWeight: 600, fontSize: 14 }}>{monthFmt.format(month)}</Typography>
                <IconButton size="small" aria-label="החודש הבא" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
                  <ChevronLeftIcon />
                </IconButton>
              </Stack>
            )}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <TextField
              placeholder="חיפוש שם – מה התורנויות שלי?"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              size="small"
              fullWidth
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
            />
            <IconButton aria-label="סינון" aria-expanded={filters} onClick={() => setFilters(!filters)} color={active ? "primary" : "default"}>
              <Badge badgeContent={active} color="primary">
                <TuneIcon />
              </Badge>
            </IconButton>
          </Stack>
          <Collapse in={filters} unmountOnExit>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
              <TextField select size="small" label="גף" value={gaf} onChange={(e) => setGaf(e.target.value)} sx={{ flex: 1 }}>
                <MenuItem value="">כל הגפים</MenuItem>
                {gafim.map((g) => (
                  <MenuItem key={g} value={g}>
                    {g}
                  </MenuItem>
                ))}
              </TextField>
              <TextField select size="small" label="סוג" value={category} onChange={(e) => setCategory(e.target.value)} sx={{ flex: 1 }}>
                <MenuItem value="">כל הסוגים</MenuItem>
                {categories.map((c) => (
                  <MenuItem key={c} value={c}>
                    {c}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
          </Collapse>
        </Stack>
      </Paper>

      {error && <Alert severity="error">{error}</Alert>}
      {!rows && !error && (
        <Box sx={{ display: "grid", placeItems: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      )}
      {rows && shown.length === 0 && (
        <Alert
          severity="info"
          action={
            !rows.length && next ? (
              <Button color="inherit" size="small" onClick={() => jumpTo(next)}>
                מעבר ל{monthFmt.format(new Date(next))}
              </Button>
            ) : undefined
          }
        >
          {rows.length
            ? "אין תורנויות שמתאימות לחיפוש או לסינון."
            : next
              ? `אין תורנויות מפורסמות בטווח הזה. הלוח המפורסם הבא מתחיל ב-${dayLabel(next)}.`
              : "אין תורנויות מפורסמות בטווח הזה."}
        </Alert>
      )}

      {days.map(([day, items]) => (
        <Box key={day} component="section" sx={{ breakInside: "avoid-page" }}>
          <DayHeader day={day} count={items.length} />
          <Paper
            variant="outlined"
            sx={{ overflow: "hidden", bgcolor: isWeekend(day) ? "rgba(232,112,15,0.035)" : "background.paper", borderRadius: 2 }}
          >
            {items.map((r, i) => (
              <Fragment key={r.slot_id}>
                {i > 0 && <Box sx={{ borderTop: 1, borderColor: "divider", mx: 1.5 }} />}
                <DutyRow r={r} query={q} />
              </Fragment>
            ))}
          </Paper>
        </Box>
      ))}
    </Stack>
  );
}
