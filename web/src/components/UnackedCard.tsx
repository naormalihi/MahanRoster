import PhoneIcon from "@mui/icons-material/PhoneOutlined";
import { Alert, Box, Button, Chip, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { isStaff } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dayLabel, spanLabel } from "../lib/dates";
import type { UnackedDuty } from "../lib/me";
import { formatPhone } from "../lib/phone";
import { Link as RouterLink } from "react-router-dom";
import { DutyWhatsAppButton } from "./DutyWhatsApp";

const HOURS = 72;

/**
 * "לא אישרו": duties of the next 72 hours whose soldier has not pressed "ראיתי" yet, soonest first.
 * אחראי השיבוצים can call and mark "וידאתי בטלפון"; a gaf commander sees his gaf, read only.
 */
export function UnackedCard() {
  const { api, me } = useAuth();
  const staff = isStaff(me);
  const [rows, setRows] = useState<UnackedDuty[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api!.unackedDuties(HOURS).then(setRows, () => setRows([]));
  }, [api]);
  useEffect(load, [load]);

  if (!rows?.length) return null;
  async function confirm(r: UnackedDuty) {
    setError(null);
    try {
      await api!.staffAck(r.assignment_id);
      setRows((x) => (x ?? []).filter((y) => y.assignment_id !== r.assignment_id));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, borderColor: "warning.main" }}>
      <Typography variant="h3" sx={{ mb: 0.5 }}>
        לא אישרו – {HOURS} השעות הקרובות
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        משובצים שעוד לא לחצו "ראיתי". מי שבלי חשבון לא יכול לאשר במערכת – שולחים לו וואטסאפ (עם קוד הצטרפות) או מתקשרים, ומסמנים כשענה.
      </Typography>
      <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>
        {rows.map((r) => {
          const tel = r.phone ? `+${r.phone}` : null;
          return (
            <Stack key={r.assignment_id} direction="row" spacing={1} sx={{ py: 0.75, alignItems: "center" }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                  <Typography sx={{ fontWeight: 600 }}>{r.full_name}</Typography>
                  {r.gaf_name && (
                    <Typography variant="caption" color="text.secondary">
                      {r.gaf_name}
                    </Typography>
                  )}
                  {!r.has_account && <Chip size="small" color="warning" variant="outlined" label="בלי חשבון" />}
                  {r.has_account && r.reminded && <Chip size="small" variant="outlined" label="קיבל תזכורת" />}
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {r.task_name}
                  {r.role === "reserve" ? " (עתודה)" : ""} · {dayLabel(r.starts_at)} · {spanLabel(r.starts_at, r.ends_at)}
                </Typography>
                {staff && !r.phone && (
                  <Typography component={RouterLink} to={`/soldiers?edit=${r.soldier_id}`} variant="caption" sx={{ color: "primary.main" }}>
                    הוספת טלפון
                  </Typography>
                )}
              </Box>
              {staff && <DutyWhatsAppButton compact query={{ assignmentId: r.assignment_id }} name={r.full_name} onError={setError} />}
              {tel && (
                <Tooltip title={`התקשרות – ${formatPhone(r.phone)}`}>
                  <IconButton size="small" component="a" href={`tel:${tel}`} aria-label={`התקשרות ל${r.full_name}`}>
                    <PhoneIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {staff && (
                <Button size="small" onClick={() => void confirm(r)} sx={{ whiteSpace: "nowrap" }}>
                  וידאתי בטלפון
                </Button>
              )}
            </Stack>
          );
        })}
      </Stack>
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
    </Paper>
  );
}
