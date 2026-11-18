import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import InfoIcon from "@mui/icons-material/InfoOutlined";
import PrintIcon from "@mui/icons-material/PrintOutlined";
import SearchIcon from "@mui/icons-material/Search";
import TuneIcon from "@mui/icons-material/Tune";
import CalendarIcon from "@mui/icons-material/CalendarMonthOutlined";
import EventIcon from "@mui/icons-material/EventOutlined";
import ViewListIcon from "@mui/icons-material/ViewListOutlined";
import ViewWeekIcon from "@mui/icons-material/ViewWeekOutlined";
import {
  Alert,
  Badge,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
  type Theme,
  alpha,
} from "@mui/material";
import { createContext, Fragment, useContext, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { isStaff, type BoardRow } from "../lib/api";
import { SlotActionsDialog } from "../components/SlotActions";
import { PrintDialog } from "../components/BoardPrint";
import { HOLIDAY_TYPES, israeliHolidays } from "../lib/catalog";
import { timeWords } from "../lib/printSheet";
import { useAuth } from "../lib/auth";
import { daySummaries, type DaySummary, dutiesIcs, groupByDay, isWeekend, matchingNames, mentions, monthGrid, people, span, weekDays, weekMatrix } from "../lib/board";
import { addDays, dayKey, dayLabel, timeLabel, upcomingWeekend, weekOf } from "../lib/dates";

type Range = "week" | "next" | "weekend" | "month";

const monthFmt = new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" });
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

/** Staff open the actions of a duty by clicking it (null for everyone else). */
const OpenSlot = createContext<((slotId: string) => void) | null>(null);

/** One duty: performers (with gaf) and reserve on one line; staff open its actions by tapping it. */
function SlotLine({ r, query, showTime }: { r: BoardRow; query: string; showTime: boolean }) {
  const [open, setOpen] = useState(false);
  const openSlot = useContext(OpenSlot);
  const performers = people(r.performers, r.performer_gafim ?? (r.gafim.length === 1 ? r.performers.map(() => r.gafim[0]) : undefined));
  const reserves = people(r.reserves, r.reserve_gafim);
  const details = !!(r.instructions || r.report_at || r.briefing_at || r.briefing_by_call);
  const hit = (n: string) => (query && n.includes(query) ? { bgcolor: "#ffe58a", color: "#000", borderRadius: 0.5, px: 0.4 } : null);

  return (
    <Box
      onClick={openSlot ? () => openSlot(r.slot_id) : undefined}
      onKeyDown={openSlot ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), openSlot(r.slot_id)) : undefined}
      role={openSlot ? "button" : undefined}
      tabIndex={openSlot ? 0 : undefined}
      aria-label={openSlot ? `פעולות על ${r.task_name}` : undefined}
      sx={{
        py: 0.25,
        borderRadius: 1,
        ...(performers.length === 0 && { bgcolor: "rgba(211,47,47,0.06)", px: 0.5, mx: -0.5 }),
        ...(openSlot && { cursor: "pointer", "&:hover": { bgcolor: "action.hover" }, "&:focus-visible": { outline: 2, outlineColor: "primary.main" } }),
      }}
    >
      <Stack direction="row" sx={{ alignItems: "flex-start", gap: 0.5 }}>
      <Stack direction="row" sx={{ alignItems: "baseline", columnGap: 1.25, rowGap: 0, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
        {r.special_points != null && (
          <Box component="span" sx={{ fontSize: 11, color: "warning.dark", border: 1, borderColor: "warning.light", borderRadius: 1, px: 0.5 }}>
            הקפצה מיוחדת · {Number(r.special_points)} נק׳
          </Box>
        )}
        {performers.length ? (
          performers.map((p, i) => (
            <Box key={i} component="span" sx={{ display: "inline-flex", alignItems: "baseline", gap: 0.5 }}>
              <Box component="span" sx={{ fontWeight: 700, fontSize: 15, ...hit(p.name) }}>
                {p.name}
              </Box>
              {p.gaf && (
                <Box component="span" sx={{ fontSize: 12, color: "text.secondary" }}>
                  {p.gaf}
                </Box>
              )}
            </Box>
          ))
        ) : (
          <Box component="span" sx={{ color: "error.main", fontWeight: 700, fontSize: 15 }}>
            לא מאויש
          </Box>
        )}
        <Box component="span" sx={{ fontSize: 13, color: "text.secondary" }}>
          עתודה:{" "}
          {reserves.length
            ? reserves.map((p, i) => (
                <Fragment key={i}>
                  {i > 0 && ", "}
                  <Box component="span" sx={hit(p.name)}>
                    {p.name}
                  </Box>
                </Fragment>
              ))
            : "—"}
        </Box>
        {showTime && (
          <Box component="span" sx={{ fontSize: 12, color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
            {timeWords(r.starts_at, r.ends_at)}
          </Box>
        )}
      </Stack>
        {details && (
          <IconButton
            size="small"
            aria-label={open ? "הסתרת הנחיות" : "הנחיות"}
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(!open);
            }}
            sx={{ p: 0.25, "@media print": { display: "none" } }}
          >
            {open ? <ExpandLessIcon sx={{ fontSize: 18 }} /> : <InfoIcon sx={{ fontSize: 18 }} />}
          </IconButton>
        )}
      </Stack>
      {!!r.activated?.length && (
        <Box sx={{ fontSize: 12, color: "warning.dark" }}>
          עתודה הופעלה: {r.activated.join(", ")}
          {!!r.replaced?.length && (
            <>
              {" "}
              · במקום{" "}
              <Box component="span" sx={{ textDecoration: "line-through", color: "text.secondary" }}>
                {r.replaced.join(", ")}
              </Box>
            </>
          )}
        </Box>
      )}
      {details && (
        <Collapse in={open} onClick={(e) => e.stopPropagation()}>
          <Box sx={{ mt: 0.75, p: 1.25, borderRadius: 1, bgcolor: "action.hover", fontSize: 13 }}>
            {(r.report_at || r.briefing_at || r.briefing_by_call) && (
              <Stack direction="row" spacing={1} sx={{ mb: r.instructions ? 0.75 : 0, flexWrap: "wrap", gap: 0.5 }}>
                {r.report_at && <Chip size="small" variant="outlined" label={`התייצבות ${timeLabel(r.report_at)}${r.report_place ? ` · ${r.report_place}` : ""}`} />}
                {r.briefing_at && (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`תדריך ${dayKey(r.briefing_at) === dayKey(r.starts_at) ? "" : `${dateFmt.format(new Date(r.briefing_at))} `}${timeLabel(r.briefing_at)}${r.briefing_place ? ` · ${r.briefing_place}` : ""}`}
                  />
                )}
                {!r.briefing_at && r.briefing_by_call && (
                  <Chip size="small" variant="outlined" label={`תדריך לפי הזימון${r.briefing_place ? ` · ${r.briefing_place}` : ""}`} />
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

/** One duty type on one day: its name and hours once, then each of its slots. */
function TaskGroup({ rows, query }: { rows: BoardRow[]; query: string }) {
  const first = rows[0];
  const time = timeWords(first.starts_at, first.ends_at);
  const sameTime = rows.every((r) => timeWords(r.starts_at, r.ends_at) === time);
  const changed = rows.filter((r) => r.changed_after_publish).map((r) => r.updated_at).sort().pop();
  return (
    <Box sx={{ px: 1.25, py: 0.9, "& + &": { borderTop: 1, borderColor: "divider" } }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 0.75 }}>
        <Box sx={{ width: 9, height: 9, borderRadius: "50%", bgcolor: first.color ?? "grey.400", flexShrink: 0 }} />
        <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{first.task_name}</Typography>
        {changed && (
          <Chip size="small" color="warning" label={`עודכן ${dateFmt.format(new Date(changed))}`} title={`עודכן אחרי הפרסום, ${dateFmt.format(new Date(changed))} ${timeLabel(changed)}`} sx={{ height: 18, fontSize: 11 }} />
        )}
        <Box sx={{ flex: 1 }} />
        {sameTime && (
          <Typography sx={{ fontSize: 12, color: "text.secondary", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{time}</Typography>
        )}
      </Stack>
      <Box sx={{ pr: 2.1 }}>
        {rows.map((r) => (
          <SlotLine key={r.slot_id} r={r} query={query} showTime={!sameTime} />
        ))}
      </Box>
    </Box>
  );
}

/** A day: the date in a column of its own, the duties beside it, grouped by duty type. */
function DayBlock({ day, items, query, holiday }: { day: string; items: BoardRow[]; query: string; holiday?: { name: string | null; rest: boolean } }) {
  const today = day === dayKey(new Date());
  const d = new Date(day + "T12:00:00");
  const weekend = isWeekend(day);
  const groups: BoardRow[][] = [];
  for (const r of items) {
    const g = groups.find((x) => x[0].task_name === r.task_name);
    if (g) g.push(r);
    else groups.push([r]);
  }
  return (
    <Paper
      component="section"
      variant="outlined"
      sx={{
        display: "grid",
        gridTemplateColumns: "60px minmax(0, 1fr)",
        overflow: "hidden",
        borderRadius: 2,
        breakInside: "avoid-page",
        ...(today && { borderColor: "secondary.main", borderInlineStartWidth: 4 }),
      }}
    >
      <Box
        sx={{
          textAlign: "center",
          py: 1,
          px: 0.5,
          borderInlineEnd: 1,
          borderColor: "divider",
          // a rest-day holiday is tinted; an observance (חנוכה, a fast…) only shows its name
          bgcolor: holiday?.rest ? "rgba(232,112,15,0.14)" : weekend ? "rgba(232,112,15,0.07)" : "action.hover",
        }}
      >
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: today ? "secondary.main" : "text.secondary" }}>{today ? "היום" : weekdayShortFmt.format(d)}</Typography>
        <Typography sx={{ fontSize: 22, fontWeight: 800, lineHeight: 1.1, color: today ? "secondary.main" : "primary.main" }}>{d.getDate()}</Typography>
        <Typography sx={{ fontSize: 11, color: "text.secondary" }}>{dateFmt.format(d)}</Typography>
        {holiday?.name && (
          <Typography sx={{ fontSize: 10.5, color: holiday.rest ? "warning.dark" : "text.secondary", fontWeight: 600, lineHeight: 1.2, mt: 0.25 }}>
            {holiday.name}
          </Typography>
        )}
      </Box>
      <Box sx={{ bgcolor: weekend ? "rgba(232,112,15,0.025)" : "background.paper" }}>
        {groups.map((g) => (
          <TaskGroup key={g[0].task_name} rows={g} query={query} />
        ))}
      </Box>
    </Paper>
  );
}

type View = "list" | "month" | "week";

const weekdayShortFmt = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", weekday: "short" });
const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const WEEKDAY_LETTERS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const localDay = (key: string) => new Date(key + "T00:00:00");

/** One day in a calendar grid: the date, a red dot when something is unstaffed, and the duty types. */
function DayCell({ d, s, inMonth, isSel, today, onPick, tall }: { d: string; s?: DaySummary; inMonth: boolean; isSel: boolean; today: string; onPick: (d: string) => void; tall: boolean }) {
  return (
    <Box
            role="button"
      tabIndex={0}
      aria-label={`${dayLabel(localDay(d))}${s ? `, ${s.total} תורנויות` : ""}`}
      onClick={() => onPick(d)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onPick(d)}
      sx={{
        minHeight: tall ? { xs: 58, sm: 96 } : 58,
        p: { xs: 0.5, sm: 0.75 },
        borderTop: 1,
        borderInlineStart: 1,
        borderColor: "divider",
        cursor: "pointer",
        opacity: inMonth ? 1 : 0.4,
        bgcolor: isSel ? (t: Theme) => alpha(t.palette.primary.main, 0.1) : isWeekend(d) ? "rgba(232,112,15,0.035)" : "background.paper",
        outline: isSel ? "2px solid" : "none",
        outlineColor: "primary.main",
        outlineOffset: -2,
        "&:hover": { bgcolor: (t: Theme) => alpha(t.palette.primary.main, 0.07) },
      }}
    >
      <Stack direction="row" sx={{ alignItems: "center", gap: 0.5 }}>
        <Box
          sx={{
            fontSize: 13,
            fontWeight: 700,
            ...(d === today ? { bgcolor: "secondary.main", color: "#fff", borderRadius: "50%", width: 22, height: 22, display: "grid", placeItems: "center" } : null),
          }}
        >
          {Number(d.slice(8))}
        </Box>
        {s && s.unstaffed > 0 && (
          <Box title={`${s.unstaffed} לא מאוישות`} sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "error.main" }} />
        )}
      </Stack>
      {s && (
        <>
          <Box sx={{ display: tall ? { xs: "none", sm: "block" } : "none", mt: 0.25 }}>
            {s.types.slice(0, 3).map((t) => (
              <Box key={t.name} sx={{ display: "flex", alignItems: "center", gap: 0.5, fontSize: 11.5, lineHeight: 1.45, whiteSpace: "nowrap", overflow: "hidden" }}>
                <Box sx={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, bgcolor: t.color ?? "grey.500" }} />
                <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                  {t.name}
                </Box>
                {t.count > 1 && <Box component="span" sx={{ color: "text.secondary" }}>×{t.count}</Box>}
              </Box>
            ))}
            {s.types.length > 3 && (
              <Box sx={{ fontSize: 11, color: "text.secondary" }}>+{s.types.slice(3).reduce((a, t) => a + t.count, 0)} נוספות</Box>
            )}
          </Box>
          <Box sx={{ display: tall ? { xs: "flex", sm: "none" } : "flex", flexWrap: "wrap", gap: 0.4, mt: 0.5 }}>
            {s.types.slice(0, 6).map((t) => (
              <Box key={t.name} sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: t.color ?? "grey.500" }} />
            ))}
          </Box>
        </>
      )}
    </Box>
  );
}

function WeekdayHeader() {
  return (
    <>
      {WEEKDAYS.map((w, i) => (
        <Box key={w} sx={{ p: 0.75, textAlign: "center", fontSize: 12, fontWeight: 700, color: "text.secondary", bgcolor: i >= 5 ? "rgba(232,112,15,0.06)" : "action.hover" }}>
          <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
            {w}
          </Box>
          <Box component="span" sx={{ display: { xs: "inline", sm: "none" } }}>
            {WEEKDAY_LETTERS[i]}
          </Box>
        </Box>
      ))}
    </>
  );
}

/** Month grid: a few type lines per day; a day opens its duties below. */
function MonthView({ month, rows, query }: { month: Date; rows: BoardRow[]; query: string }) {
  const weeks = monthGrid(month.getFullYear(), month.getMonth() + 1);
  const sums = daySummaries(rows);
  const thisMonth = (d: string) => Number(d.slice(5, 7)) === month.getMonth() + 1;
  const today = dayKey(new Date());
  const firstBusy = weeks.flat().find((d) => thisMonth(d) && sums.has(d));
  const [picked, setPicked] = useState<string | null>(null);
  const selected = picked ?? (thisMonth(today) && sums.has(today) ? today : firstBusy ?? null);
  const dayRows = selected ? groupByDay(rows).find(([d]) => d === selected)?.[1] ?? [] : [];
  return (
    <Stack spacing={1.5}>
      <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 2 }}>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
          <WeekdayHeader />
          {weeks.flat().map((d) => (
            <DayCell key={d} d={d} s={sums.get(d)} inMonth={thisMonth(d)} isSel={d === selected} today={today} onPick={setPicked} tall />
          ))}
        </Box>
      </Paper>
      {selected && (
        <Box component="section">
          {dayRows.length ? (
            <DayBlock day={selected} items={dayRows} query={query} />
          ) : (
            <Typography color="text.secondary">אין תורנויות ביום הזה.</Typography>
          )}
        </Box>
      )}
    </Stack>
  );
}

/** The week: on a phone a strip of days with dots that opens a day below (like the month); on a wide screen the duty × day table. */
function WeekView(props: { sunday: Date; rows: BoardRow[]; query: string }) {
  const narrow = useMediaQuery((t: Theme) => t.breakpoints.down("md"));
  return narrow ? <WeekStrip {...props} /> : <WeekTable {...props} />;
}

function WeekStrip({ sunday, rows, query }: { sunday: Date; rows: BoardRow[]; query: string }) {
  const days = weekDays(dayKey(sunday));
  const sums = daySummaries(rows);
  const today = dayKey(new Date());
  const [picked, setPicked] = useState<string | null>(null);
  const selected = picked && days.includes(picked) ? picked : days.includes(today) ? today : (days.find((d) => sums.has(d)) ?? days[0]);
  const dayRows = groupByDay(rows).find(([d]) => d === selected)?.[1] ?? [];
  return (
    <Stack spacing={1.5}>
      <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 2 }}>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
          <WeekdayHeader />
          {days.map((d) => (
            <DayCell key={d} d={d} s={sums.get(d)} inMonth isSel={d === selected} today={today} onPick={setPicked} tall={false} />
          ))}
        </Box>
      </Paper>
      {dayRows.length ? <DayBlock day={selected} items={dayRows} query={query} /> : <Typography color="text.secondary">אין תורנויות ביום הזה.</Typography>}
    </Stack>
  );
}

/** Duty type × day: who does what this week. Made for printing and the notice board. */
function WeekTable({ sunday, rows, query }: { sunday: Date; rows: BoardRow[]; query: string }) {
  const days = weekDays(dayKey(sunday));
  const matrix = weekMatrix(rows, days);
  const today = dayKey(new Date());
  if (!matrix.length) return null;
  return (
    <Paper variant="outlined" sx={{ overflowX: "auto", borderRadius: 2 }}>
      <Box component="table" sx={{ borderCollapse: "collapse", width: "100%", minWidth: 760, fontSize: 13, "& td, & th": { border: 1, borderColor: "divider", p: 0.75, verticalAlign: "top" } }}>
        <thead>
          <tr>
            <Box component="th" sx={{ width: 130, textAlign: "start", bgcolor: "action.hover" }}>
              תורנות
            </Box>
            {days.map((d) => (
              <Box
                component="th"
                key={d}
                sx={{ textAlign: "center", bgcolor: d === today ? "rgba(232,112,15,0.15)" : isWeekend(d) ? "rgba(232,112,15,0.06)" : "action.hover" }}
              >
                <Box sx={{ fontWeight: 700 }}>{weekdayShortFmt.format(localDay(d))}</Box>
                <Box sx={{ fontWeight: 400, color: "text.secondary", fontSize: 12 }}>{dateFmt.format(localDay(d))}</Box>
              </Box>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((m) => (
            <tr key={m.task}>
              <Box component="th" sx={{ textAlign: "start", fontWeight: 700, borderInlineStart: `4px solid ${m.color ?? "#999"} !important` }}>
                {m.task}
              </Box>
              {days.map((d) => (
                <Box component="td" key={d} sx={{ bgcolor: isWeekend(d) ? "rgba(232,112,15,0.03)" : undefined }}>
                  {(m.byDay.get(d) ?? []).map((r) => {
                    const t = span(r.starts_at, r.ends_at);
                    return (
                      <Box key={r.slot_id} sx={{ "& + &": { mt: 0.75, pt: 0.75, borderTop: 1, borderColor: "divider" } }}>
                        {r.performers.length ? (
                          r.performers.map((n) => (
                            <Box key={n} sx={{ fontWeight: 700, ...(query && n.includes(query) ? { bgcolor: "#ffe58a", color: "#000", borderRadius: 0.5, px: 0.3 } : null) }}>
                              {n}
                            </Box>
                          ))
                        ) : (
                          <Box sx={{ color: "error.main", fontWeight: 700 }}>לא מאויש</Box>
                        )}
                        {r.reserves.length > 0 && <Box sx={{ color: "text.secondary", fontSize: 12 }}>עתודה: {r.reserves.join(", ")}</Box>}
                        <Box sx={{ color: "text.secondary", fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>
                          {t.from}–{t.to}
                          {t.until && ` · ${t.until}`}
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              ))}
            </tr>
          ))}
        </tbody>
      </Box>
    </Paper>
  );
}

/** "My duties" to the phone's calendar: one person's coming duties as an .ics file. */
function CalendarExport({ query }: { query: string }) {
  const { api } = useAuth();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRows(null);
    setError(null);
    const now = new Date();
    api!
      .board(now.toISOString(), addDays(now, 400).toISOString())
      .then((r) => {
        setRows(r);
        const names = matchingNames(r, query);
        setName(names.length === 1 ? names[0] : "");
      })
      .catch((e) => setError((e as Error).message));
  }, [api, open, query]);

  const names = rows ? matchingNames(rows, query) : [];
  const preview = rows && name ? dutiesIcs(rows, name) : null;

  function download() {
    if (!preview) return;
    const url = URL.createObjectURL(new Blob([preview.ics], { type: "text/calendar;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `תורנויות-${name}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return (
    <>
      <Button size="small" variant="outlined" startIcon={<EventIcon />} onClick={() => setOpen(true)} disabled={!query.trim()} sx={{ whiteSpace: "nowrap", flexShrink: 0 }}>
        ליומן
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>התורנויות שלי ביומן</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            {error && <Alert severity="error">{error}</Alert>}
            {!rows && !error && <CircularProgress size={22} />}
            {rows && names.length === 0 && <Alert severity="info">לא נמצאו תורנויות קרובות לשם "{query.trim()}".</Alert>}
            {names.length > 1 && (
              <TextField select label="בחירת חייל" value={name} onChange={(e) => setName(e.target.value)} fullWidth>
                {names.map((n) => (
                  <MenuItem key={n} value={n}>
                    {n}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {preview && (
              <Typography variant="body2">
                <b>{preview.count}</b> תורנויות קרובות של {name}, כמבצע או כעתודה, עם השעות וההנחיות ותזכורת 12 שעות לפני. פותחים את הקובץ בטלפון,
                והתורנויות נכנסות ליומן. אחרי שינוי בלוח – מורידים שוב.
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>סגירה</Button>
          <Button variant="contained" startIcon={<EventIcon />} onClick={download} disabled={!preview?.count}>
            הורדת קובץ יומן
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export function BoardPage() {
  const { api, me } = useAuth();
  const staff = isStaff(me);
  const [slotOpen, setSlotOpen] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [params, setParams] = useSearchParams();
  const view: View = params.get("view") === "month" ? "month" : params.get("view") === "week" ? "week" : "list";
  const setView = (v: View) => setParams(v === "list" ? {} : { view: v }, { replace: true });
  const [range, setRange] = useState<Range>("week");
  const [month, setMonth] = useState<Date>(() => monthStartOf(new Date()));
  const [sunday, setSunday] = useState<Date>(() => weekOf()[0]);
  const [next, setNext] = useState<string | null>(null);
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [gaf, setGaf] = useState("");
  const [category, setCategory] = useState("");
  const [filters, setFilters] = useState(false);
  const [printing, setPrinting] = useState(false);

  const [from, to] = useMemo((): [Date, Date] => {
    if (view === "month") {
      const g = monthGrid(month.getFullYear(), month.getMonth() + 1);
      return [localDay(g[0][0]), addDays(localDay(g[g.length - 1][6]), 1)];
    }
    if (view === "week") return [sunday, addDays(sunday, 7)];
    return rangeOf(range, month);
  }, [view, range, month, sunday]);

  // a new range shows a spinner; a change made on the board refreshes in place (no jump)
  const rangeKey = `${from.toISOString()}|${to.toISOString()}`;
  const [loadedKey, setLoadedKey] = useState("");
  useEffect(() => {
    if (loadedKey !== rangeKey) {
      setRows(null);
      setNext(null);
    }
    api!
      .board(from.toISOString(), to.toISOString())
      .then((r) => {
        setRows(r);
        setLoadedKey(rangeKey);
        // nothing here: offer the next published date (a cycle is published about two months ahead)
        if (!r.length) api!.nextPublished(to.toISOString()).then(setNext).catch(() => setNext(null));
      })
      .catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, from, to, version]);

  const jumpTo = (iso: string) => {
    const d = new Date(iso);
    setMonth(monthStartOf(d));
    setSunday(weekOf(d)[0]);
    if (view === "list") setRange("month");
  };

  const gafOf = (r: BoardRow) => people(r.performers, r.performer_gafim ?? r.gafim).map((p) => p.gaf).filter(Boolean);
  const gafim = useMemo(() => [...new Set((rows ?? []).flatMap(gafOf))].sort((a, b) => a.localeCompare(b, "he")), [rows]);
  const categories = useMemo(() => [...new Set((rows ?? []).map((r) => r.category_name ?? ""))].filter(Boolean).sort(), [rows]);

  // holiday names beside the date (the board's own calendar, in the browser)
  const holidays = useMemo(() => {
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return new Map(israeliHolidays(iso(from), iso(to)).map((h) => [h.day, { name: h.note, rest: HOLIDAY_TYPES.has(h.day_type) }]));
  }, [from, to]);

  const q = query.trim();
  const shown = (rows ?? []).filter((r) => (!gaf || gafOf(r).includes(gaf)) && (!category || r.category_name === category) && mentions(r, q));
  const days = groupByDay(shown);
  const unstaffed = shown.filter((r) => !r.performers.length).length;
  const active = (gaf ? 1 : 0) + (category ? 1 : 0);
  const title =
    view === "month" || (view === "list" && range === "month")
      ? monthFmt.format(month)
      : `${dateFmt.format(from)} – ${dateFmt.format(addDays(to, -1))}`;

  const nav = (label: string, prev: () => void, nextFn: () => void) => (
    <Stack direction="row" sx={{ alignItems: "center" }}>
      <IconButton size="small" aria-label="הקודם" onClick={prev}>
        <ChevronRightIcon />
      </IconButton>
      <Typography sx={{ minWidth: 104, textAlign: "center", fontWeight: 600, fontSize: 14 }}>{label}</Typography>
      <IconButton size="small" aria-label="הבא" onClick={nextFn}>
        <ChevronLeftIcon />
      </IconButton>
    </Stack>
  );
  const monthNav = nav(
    monthFmt.format(month),
    () => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1)),
    () => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1)),
  );

  return (
    <OpenSlot.Provider value={staff ? setSlotOpen : null}>
    <Stack spacing={1.5} sx={{ maxWidth: view === "week" ? 1400 : 1100, mx: "auto", width: "100%" }}>
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
        <IconButton aria-label="הדפסה" onClick={() => setPrinting(true)} sx={{ display: { sm: "none" }, "@media print": { display: "none" } }}>
          <PrintIcon />
        </IconButton>
        <Button
          variant="outlined"
          startIcon={<PrintIcon />}
          onClick={() => setPrinting(true)}
          sx={{ display: { xs: "none", sm: "inline-flex" }, "@media print": { display: "none" } }}
        >
          הדפסה
        </Button>
      </Stack>

      <Paper variant="outlined" sx={{ p: 1.25, "@media print": { display: "none" } }}>
        <Stack spacing={1.25}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
            <ToggleButtonGroup value={view} exclusive onChange={(_, v) => v && setView(v)} size="small" color="primary" sx={{ "& .MuiToggleButton-root": { px: 1.25, py: 0.5 } }}>
              <ToggleButton value="list" aria-label="רשימה">
                <ViewListIcon fontSize="small" sx={{ ml: 0.5 }} />
                רשימה
              </ToggleButton>
              <ToggleButton value="month" aria-label="חודש">
                <CalendarIcon fontSize="small" sx={{ ml: 0.5 }} />
                חודש
              </ToggleButton>
              <ToggleButton value="week" aria-label="שבוע">
                <ViewWeekIcon fontSize="small" sx={{ ml: 0.5 }} />
                שבוע
              </ToggleButton>
            </ToggleButtonGroup>
            {view === "list" && (
              <ToggleButtonGroup value={range} exclusive onChange={(_, v) => v && setRange(v)} size="small" sx={{ "& .MuiToggleButton-root": { px: 1.25, py: 0.5 } }}>
                <ToggleButton value="week">השבוע</ToggleButton>
                <ToggleButton value="next">הבא</ToggleButton>
                <ToggleButton value="weekend">סופ"ש</ToggleButton>
                <ToggleButton value="month">חודש</ToggleButton>
              </ToggleButtonGroup>
            )}
            {(view === "month" || (view === "list" && range === "month")) && monthNav}
            {view === "week" &&
              nav(
                `${dateFmt.format(sunday)} – ${dateFmt.format(addDays(sunday, 6))}`,
                () => setSunday(addDays(sunday, -7)),
                () => setSunday(addDays(sunday, 7)),
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
            <CalendarExport query={query} />
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

      {rows && view === "month" && (rows.length > 0 || !next) && <MonthView key={month.toISOString()} month={month} rows={shown} query={q} />}
      {rows && view === "week" && <WeekView sunday={sunday} rows={shown} query={q} />}
      {view === "list" && days.map(([day, items]) => <DayBlock key={day} day={day} items={items} query={q} holiday={holidays.get(day)} />)}
    </Stack>
      {printing && (
        <PrintDialog
          api={api!}
          month={view === "month" || (view === "list" && range === "month") ? month : monthStartOf(view === "week" ? sunday : from)}
          onClose={() => setPrinting(false)}
          onPrintScreen={() => setTimeout(() => window.print(), 300)}
        />
      )}
      {slotOpen && (
        <SlotActionsDialog
          slotId={slotOpen}
          onClose={() => setSlotOpen(null)}
          onChanged={() => setVersion((v) => v + 1)}
        />
      )}
    </OpenSlot.Provider>
  );
}
