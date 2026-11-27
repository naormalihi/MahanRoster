import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import { alpha, useTheme } from "@mui/material/styles";
import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { ContactsDialog } from "./ContactCard";

/**
 * "המחזור הבא" on the employee's home (2.72): the one cycle after today's – the only one whose stage
 * still changes – in three steps instead of the staff's ten, and where his own requests for it stand.
 */
export type SoldierStage = "open" | "preparing" | "published";

export interface NextCycleInfo {
  name: string;
  stage: SoldierStage;
  /** the requests deadline (ISO), if set */
  deadline: string | null;
  published_at: string | null;
  mine: { pending: number; approved: number; rejected: number };
}

const STEPS: { stage: SoldierStage; label: string }[] = [
  { stage: "open", label: "הגשת בקשות" },
  { stage: "preparing", label: "הלוח בהכנה" },
  { stage: "published", label: "פורסם" },
];

const dm = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
};
const daysLeft = (iso: string) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000));

export function NextCycleCard({ info }: { info: NextCycleInfo }) {
  const t = useTheme();
  const [contacts, setContacts] = useState(false);
  const at = STEPS.findIndex((s) => s.stage === info.stage);
  const left = info.deadline ? daysLeft(info.deadline) : null;
  const { pending, approved, rejected } = info.mine;
  const anyRequests = pending + approved + rejected > 0;

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
      <Typography variant="body2" color="text.secondary">
        המחזור הבא
      </Typography>
      <Typography variant="h3" sx={{ mb: 1.5 }}>
        {info.name}
      </Typography>

      {/* three steps: done, now, ahead */}
      <Stack direction="row" sx={{ alignItems: "flex-start", mb: 1.75 }}>
        {STEPS.map((s, i) => {
          const done = i < at;
          const now = i === at;
          const c = done || now ? t.palette.primary.main : t.palette.text.disabled;
          return (
            <Box key={s.stage} sx={{ flex: 1, position: "relative", textAlign: "center" }}>
              {i > 0 && (
                <Box
                  sx={{
                    position: "absolute",
                    top: 13,
                    insetInlineEnd: "50%",
                    width: "100%",
                    height: 2,
                    bgcolor: i <= at ? "primary.main" : "divider",
                  }}
                />
              )}
              <Box
                sx={{
                  position: "relative",
                  mx: "auto",
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 13,
                  fontWeight: 700,
                  // solid under the tint, so the line behind does not show through
                  bgcolor: done ? c : "background.paper",
                  backgroundImage: now ? `linear-gradient(${alpha(c, 0.18)}, ${alpha(c, 0.18)})` : undefined,
                  color: done ? "primary.contrastText" : c,
                  border: 2,
                  borderColor: done || now ? c : "divider",
                }}
              >
                {done ? <CheckIcon sx={{ fontSize: 16 }} /> : i + 1}
              </Box>
              <Typography variant="caption" sx={{ display: "block", mt: 0.5, fontWeight: now ? 700 : 400, color: now ? "text.primary" : "text.secondary" }}>
                {s.label}
              </Typography>
            </Box>
          );
        })}
      </Stack>

      {/* what it means for him now */}
      {info.stage === "open" && (
        <Box sx={{ bgcolor: alpha(t.palette.primary.main, 0.08), borderRadius: 2, p: 1.5 }}>
          {info.deadline ? (
            <>
              <Typography sx={{ fontWeight: 700 }}>
                אפשר להגיש בקשות עד {dm(info.deadline)}
                <Typography component="span" sx={{ fontWeight: 400, color: left !== null && left <= 3 ? "warning.main" : "text.secondary" }}>
                  {" "}
                  · {left === 0 ? "היום אחרון" : left === 1 ? "נשאר יום אחד" : `עוד ${left} ימים`}
                </Typography>
              </Typography>
              <Typography variant="body2" color="text.secondary">
                פטור, היעדרות או יום שלא מתאים לך – עכשיו, לפני שהשיבוץ מתחיל.
              </Typography>
            </>
          ) : (
            <Typography variant="body2">מועד ההגשה עוד לא נקבע. אפשר כבר להגיש בקשות.</Typography>
          )}
          <Button variant="contained" size="small" startIcon={<AddIcon />} component={RouterLink} to="/requests?new=1" sx={{ mt: 1.25 }}>
            בקשה חדשה
          </Button>
        </Box>
      )}
      {info.stage === "preparing" && (
        <Box sx={{ bgcolor: "action.hover", borderRadius: 2, p: 1.5 }}>
          <Typography sx={{ fontWeight: 700 }}>ההגשה נסגרה – הלוח בהכנה</Typography>
          <Typography variant="body2" color="text.secondary">
            תקבל התראה כשהלוח יפורסם. בקשה דחופה – דרך אחראי השיבוצים.
          </Typography>
          <Button size="small" onClick={() => setContacts(true)} sx={{ mt: 0.75, px: 0 }}>
            למי לפנות
          </Button>
        </Box>
      )}
      {info.stage === "published" && (
        <Box sx={{ bgcolor: alpha(t.palette.success.main, 0.1), borderRadius: 2, p: 1.5 }}>
          <Typography sx={{ fontWeight: 700 }}>הלוח פורסם{info.published_at ? ` ב-${dm(info.published_at)}` : ""}</Typography>
          <Typography variant="body2" color="text.secondary">
            המשימות שלך למחזור מופיעות למעלה.
          </Typography>
        </Box>
      )}

      {/* his own requests for the cycle */}
      <Stack
        direction="row"
        component={RouterLink}
        to="/requests"
        sx={{ mt: 1.5, alignItems: "center", gap: 1, color: "inherit", textDecoration: "none", flexWrap: "wrap" }}
      >
        <Typography variant="body2" color="text.secondary">
          הבקשות שלי למחזור:
        </Typography>
        {anyRequests ? (
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {[
              pending ? `${pending} ממתינות` : "",
              approved ? `${approved} בתוקף` : "",
              rejected ? `${rejected} נדחו` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </Typography>
        ) : (
          <Typography variant="body2">אין</Typography>
        )}
        <Typography variant="body2" color="primary" sx={{ marginInlineStart: "auto" }}>
          לבקשות ←
        </Typography>
      </Stack>
      {contacts && <ContactsDialog onClose={() => setContacts(false)} />}
    </Paper>
  );
}
