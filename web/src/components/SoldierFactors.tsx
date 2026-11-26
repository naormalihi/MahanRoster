import AwayIcon from "@mui/icons-material/EventBusyOutlined";
import HolidayIcon from "@mui/icons-material/StarBorderOutlined";
import NightIcon from "@mui/icons-material/BedtimeOutlined";
import ParentIcon from "@mui/icons-material/FamilyRestroomOutlined";
import RangeIcon from "@mui/icons-material/GpsFixedOutlined";
import ReliefIcon from "@mui/icons-material/BalanceOutlined";
import ServiceIcon from "@mui/icons-material/BadgeOutlined";
import NewcomerIcon from "@mui/icons-material/PersonAddAltOutlined";
import ShacharIcon from "@mui/icons-material/SchoolOutlined";
import { Box, Chip, CircularProgress, Paper, Stack, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import type { Api } from "../lib/api";
import type { Absence, AbsenceType, Exemption, ExemptionType } from "../lib/cycles";
import { soldierFactors, type Factor, type FactorIcon } from "../lib/soldierFactors";
import type { SoldierDetail } from "../lib/soldiers";

const ICON: Record<FactorIcon, typeof AwayIcon> = {
  away: AwayIcon,
  night: NightIcon,
  relief: ReliefIcon,
  parent: ParentIcon,
  shachar: ShacharIcon,
  range: RangeIcon,
  holiday: HolidayIcon,
  service: ServiceIcon,
  newcomer: NewcomerIcon,
};

interface Shared {
  details: Map<string, SoldierDetail>;
  exemptions: Exemption[];
  exemptionTypes: ExemptionType[];
  absences: Absence[];
  absenceTypes: AbsenceType[];
  holidays: Map<string, { day: string; task_name: string }>;
  graceDays: number;
}
// one load per cycle, shared by every soldier dialog opened on it
const cache = new Map<string, Promise<Shared>>();
function loadShared(api: Api, cycle: { id: string; start: string; end: string }): Promise<Shared> {
  if (!cache.has(cycle.id)) {
    const since = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    const p = Promise.all([
      api.soldierDetails(),
      api.exemptions(cycle.start, cycle.end),
      api.exemptionTypes(),
      api.absences(cycle.start, cycle.end),
      api.absenceTypes(),
      api.recentHolidayDuties(since).catch(() => []),
      api.scoringSettings().then((x) => x.grace_days).catch(() => 90),
    ]).then(([d, ex, et, ab, at, hol, graceDays]) => ({
      details: new Map(d.map((s) => [s.id, s])),
      exemptions: ex,
      exemptionTypes: et,
      absences: ab,
      absenceTypes: at,
      holidays: new Map(hol.map((h) => [h.soldier_id, h])),
      graceDays,
    }));
    p.catch(() => cache.delete(cycle.id));
    cache.set(cycle.id, p);
  }
  return cache.get(cycle.id)!;
}

/** "מה משפיע על השיבוץ שלו": the soldier's data that steers his schedule, one line each. */
export function SoldierFactors(props: {
  api: Api;
  cycle: { id: string; start: string; end: string };
  soldierId: string;
  creditDays: number;
  credit: number;
  taskName: (id: string) => string;
}) {
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [error, setError] = useState(false);
  const { api, cycle, soldierId, creditDays, credit, taskName } = props;
  useEffect(() => {
    let live = true;
    loadShared(api, cycle)
      .then((sh) => {
        const soldier = sh.details.get(soldierId);
        if (!live) return;
        if (!soldier) return setFactors([]);
        setFactors(
          soldierFactors({
            soldier,
            cycle,
            creditDays,
            credit,
            exemptions: sh.exemptions,
            exemptionTypes: sh.exemptionTypes,
            absences: sh.absences,
            absenceTypes: sh.absenceTypes,
            taskName,
            holiday: sh.holidays.get(soldierId) ?? null,
            graceDays: sh.graceDays,
            today: new Date().toISOString().slice(0, 10),
          }),
        );
      })
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soldierId, cycle.id, creditDays, credit]);

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography sx={{ fontWeight: 600, fontSize: 14, mb: 0.5 }}>מה משפיע על השיבוץ שלו</Typography>
      {error ? (
        <Typography variant="body2" color="text.secondary">
          לא הצלחתי לטעון את הנתונים.
        </Typography>
      ) : !factors ? (
        <CircularProgress size={18} />
      ) : !factors.length ? (
        <Typography variant="body2" color="text.secondary">
          אין נתונים מיוחדים – משובץ לפי הכללים הרגילים.
        </Typography>
      ) : (
        <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>
          {factors.map((f, i) => {
            const Icon = ICON[f.icon];
            return (
              <Stack key={i} direction="row" spacing={1} sx={{ py: 0.9 }}>
                <Icon fontSize="small" sx={{ color: "text.secondary", mt: 0.25 }} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                    {f.title}
                    {f.tag && (
                      <Chip
                        size="small"
                        label={f.tag.text}
                        color={f.tag.tone === "warning" ? "warning" : f.tag.tone === "info" ? "info" : "default"}
                        variant="outlined"
                        sx={{ height: 20, fontSize: 11, mr: 0.75, verticalAlign: "middle" }}
                      />
                    )}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
                    {f.effect}
                  </Typography>
                </Box>
              </Stack>
            );
          })}
        </Stack>
      )}
    </Paper>
  );
}
