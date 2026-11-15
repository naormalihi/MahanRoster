import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Accordion, AccordionDetails, AccordionSummary, Box, Button, Chip, Stack, Typography } from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { isStaff } from "../lib/api";
import { useAuth } from "../lib/auth";
import { SUBMISSION_LABEL, type GafReports } from "../lib/gaf";

const fmt = (d: string) => d.slice(0, 10).split("-").reverse().join("/");

/**
 * What the gafs sent from their own screen (version 2.0, stage 2.3): on the constraints step,
 * which gafs submitted and approved their constraints; on the scheduling step, the gafs'
 * comments on the draft, which נע"ת marks handled.
 */
export function GafReportsPanel({ cycleId, show }: { cycleId: string; show: "submissions" | "comments" }) {
  const { api, me } = useAuth();
  const [r, setR] = useState<GafReports | null>(null);
  const load = useCallback(() => {
    api!.gafReports(cycleId).then(setR).catch(() => setR(null));
  }, [api, cycleId]);
  useEffect(load, [load]);
  if (!r) return null;

  if (show === "submissions") {
    const done = r.submissions.filter((s) => s.status === "approved" || s.status === "late").length;
    return (
      <Accordion variant="outlined" disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2">
            אישורי הגפים · {done} מתוך {r.submissions.length} אישרו
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={0.75}>
            {r.submissions.map((s) => (
              <Stack key={s.gaf} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography variant="body2" sx={{ flex: 1 }}>
                  {s.gaf}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {s.approved_at ? `${fmt(s.approved_at)}${s.approved_by ? ` · ${s.approved_by}` : ""}` : s.submitted_at ? fmt(s.submitted_at) : ""}
                </Typography>
                <Chip
                  size="small"
                  label={s.status ? SUBMISSION_LABEL[s.status] : "לא הוגש"}
                  color={s.status === "approved" ? "success" : s.status === "late" ? "warning" : s.status === "submitted" ? "info" : "default"}
                />
              </Stack>
            ))}
          </Stack>
        </AccordionDetails>
      </Accordion>
    );
  }

  if (!r.comments.length) return null;
  const open = r.comments.filter((c) => c.status === "open").length;
  return (
    <Accordion variant="outlined" disableGutters defaultExpanded={open > 0}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="subtitle2">
          הערות הגפים על הטיוטה{open ? ` · ${open} פתוחות` : " · הכול טופל"}
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>
          {r.comments.map((c) => (
            <Stack key={c.id} direction="row" spacing={1} sx={{ alignItems: "center", py: 0.75, opacity: c.status === "handled" ? 0.6 : 1 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2">{c.text}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {c.gaf} · {c.author} · {fmt(c.created_at)}
                  {c.slot_id ? " · על תורנות" : " · כללי"}
                </Typography>
              </Box>
              {isStaff(me) && (
                <Button
                  size="small"
                  data-read
                  onClick={async () => {
                    await api!.handleDraftComment(c.id, c.status === "open");
                    load();
                  }}
                >
                  {c.status === "open" ? "טופל" : "פתיחה מחדש"}
                </Button>
              )}
            </Stack>
          ))}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
