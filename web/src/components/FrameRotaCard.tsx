import { Alert, Box, Chip, Divider, Paper, Stack, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { dayKey } from "../lib/dates";
import { dm, monthName, nextRotaDay, rotaMonthOver, weekdayOf, WEEKDAYS, type FrameRotaDay, type FrameRotaStatus, type MyFrameRota } from "../lib/frameRota";
import { useLiveTick } from "../lib/live";

/** "תורנויות מסגרת" of the employee's screen: every active duty, this month and next. */
export function useMyFrameRotas(): MyFrameRota[] {
  const live = useLiveTick();
  const { api } = useAuth();
  const [rotas, setRotas] = useState<MyFrameRota[]>([]);
  useEffect(() => {
    api!.myFrameRotas().then(setRotas).catch(() => setRotas([]));
  }, [api, live]);
  return rotas;
}

const when = (r: MyFrameRota) => `כל יום ${WEEKDAYS[r.weekday]} · ${r.at_time}${r.place ? ` · ${r.place}` : ""}`;

function Days({ days, today }: { days: FrameRotaDay[]; today: string }) {
  const next = nextRotaDay(days, today);
  const tomorrow = dayKey(new Date(Date.now() + 86_400_000));
  const label = (d: FrameRotaDay) => {
    const base = d.actual === d.planned ? dm(d.actual) : `${weekdayOf(d.actual)} ${dm(d.actual)}`;
    return d.actual === today ? `${base} · היום` : d.actual === tomorrow ? `${base} · מחר` : base;
  };
  const chip = (d: FrameRotaDay) => {
    const past = d.actual < today;
    return (
      <Chip
        size="small"
        color={d === next ? "primary" : "default"}
        variant={d === next ? "filled" : "outlined"}
        label={label(d)}
        sx={past ? { opacity: 0.5, textDecoration: "line-through" } : undefined}
      />
    );
  };
  const moved = days.filter((d) => d.actual !== d.planned);
  const plain = days.filter((d) => d.actual === d.planned);
  return (
    <Stack spacing={0.75} sx={{ my: 1.25 }}>
      {moved.map((d) => (
        <Stack key={d.planned} direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Typography variant="body2" sx={{ textDecoration: "line-through", color: "text.disabled" }}>
            {weekdayOf(d.planned)} {dm(d.planned)}
          </Typography>
          <Typography variant="body2" aria-hidden>
            ←
          </Typography>
          {chip(d)}
          {d.why && (
            <Typography variant="caption" color="text.secondary">
              {d.why}
            </Typography>
          )}
        </Stack>
      ))}
      {plain.length > 0 && (
        <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap" }}>
          {plain.map((d) => (
            <Box key={d.planned}>{chip(d)}</Box>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

/** The frame on duty: a card in its month, a notice in the month before. */
export function FrameRotaDuty({ rotas }: { rotas: MyFrameRota[] }) {
  const today = dayKey(new Date());
  return (
    <>
      {rotas.map((r) => {
        if (r.current.mine && !rotaMonthOver(r.current.days, today))
          return (
            <Paper key={r.id} variant="outlined" sx={{ p: 2, borderRadius: 3, borderColor: "primary.main", borderWidth: 2 }}>
              <Typography variant="overline" color="primary">
                תורנות מסגרת · {monthName(r.current.month)} · התור שלך
              </Typography>
              <Typography variant="h3">{r.name}</Typography>
              <Typography variant="body2" color="text.secondary">
                {when(r)}
              </Typography>
              <Days days={r.current.days} today={today} />
              {r.details && (
                <>
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="body2" sx={{ whiteSpace: "pre-line" }}>
                    {r.details}
                  </Typography>
                </>
              )}
            </Paper>
          );
        if (r.next.mine)
          return (
            <Alert key={r.id} severity="info" variant="outlined" sx={{ borderRadius: 3 }}>
              <b>בחודש הבא התור של המסגרת שלך</b>
              <br />
              {monthName(r.next.month)} · {r.name} · {when(r)}
              <Typography variant="caption" component="div" color="text.secondary" sx={{ mt: 0.5 }}>
                {r.next.days
                  .map((d) => (d.actual === d.planned ? dm(d.actual) : `${weekdayOf(d.actual)} ${dm(d.actual)} (במקום ${dm(d.planned)}${d.why ? ` – ${d.why}` : ""})`))
                  .join(" · ")}
              </Typography>
            </Alert>
          );
        return null;
      })}
    </>
  );
}

/** For everyone: who is on duty this month and next. */
export function FrameRotaLine({ rotas: all }: { rotas: MyFrameRota[] }) {
  const today = dayKey(new Date());
  // not the one whose card is already up
  const rotas = all.filter((r) => !(r.current.mine && !rotaMonthOver(r.current.days, today)));
  if (!rotas.length) return null;
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        תורנויות מסגרת
      </Typography>
      <Stack spacing={0.5}>
        {rotas.map((r) => (
          <Typography key={r.id} variant="body2">
            <b>{r.name}</b> · {when(r)}
            <br />
            החודש: {r.current.gaf_name ?? "—"}
            {r.current.commander ? ` (${r.current.commander})` : ""} · ב{monthName(r.next.month)}: {r.next.gaf_name ?? "—"}
          </Typography>
        ))}
      </Stack>
    </Paper>
  );
}

/** "נתוני היחידה": who is on each frame duty this month and next (staff and the unit commander). */
export function FrameRotaStatusLine() {
  const live = useLiveTick();
  const { api } = useAuth();
  const [rows, setRows] = useState<FrameRotaStatus[]>([]);
  useEffect(() => {
    api!.frameRotasStatus().then(setRows).catch(() => setRows([]));
  }, [api, live]);
  if (!rows.length) return null;
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      {rows.map((r) => (
        <Typography key={r.id} variant="body2">
          <b>{r.name}</b> · החודש: {r.current.gaf_name ?? "—"}
          {r.current.commander ? ` (${r.current.commander})` : ""} · ב{monthName(r.next.month)}: {r.next.gaf_name ?? "—"}
        </Typography>
      ))}
    </Paper>
  );
}
