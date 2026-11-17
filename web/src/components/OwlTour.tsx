import { Box, Button, Dialog, DialogActions, DialogContent, Typography } from "@mui/material";
import { useState } from "react";
import { isIos, isStandalone } from "../lib/notifications";
import type { TourStep } from "../lib/tour";
import { Mascot } from "./Mascot";

function InstallHint() {
  if (isStandalone()) {
    return (
      <Typography variant="body2" color="success.main" sx={{ fontWeight: 700 }}>
        ✓ כבר פתחת אותי ממסך הבית.
      </Typography>
    );
  }
  const ios = isIos();
  return (
    <Box component="ol" sx={{ m: 0, pr: 2.5, pl: 0, "& li + li": { mt: 0.5 } }}>
      {ios ? (
        <>
          <Typography component="li" variant="body2">פתח את האתר ב-<b>ספארי</b>.</Typography>
          <Typography component="li" variant="body2">לחץ על <b>שיתוף</b> (הריבוע עם החץ למעלה).</Typography>
          <Typography component="li" variant="body2">בחר <b>הוספה למסך הבית</b>, ומעכשיו פתח מהאייקון של הינשוף.</Typography>
          <Typography component="li" variant="body2">שם, בפעמון למעלה, מפעילים התראות לטלפון.</Typography>
        </>
      ) : (
        <>
          <Typography component="li" variant="body2">בכרום: תפריט <b>⋮</b> ← <b>התקנת אפליקציה</b> (או "הוספה למסך הבית").</Typography>
          <Typography component="li" variant="body2">בפעמון למעלה מפעילים התראות לטלפון.</Typography>
        </>
      )}
    </Box>
  );
}

/** Three short steps from the owl. Closing in any way (skip, finish, outside click) counts as seen. */
export function OwlTour({ open, steps, onClose }: { open: boolean; steps: TourStep[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const step = steps[Math.min(i, steps.length - 1)];
  const last = i >= steps.length - 1;
  const close = () => {
    onClose();
    setTimeout(() => setI(0), 300);
  };
  if (!step) return null;
  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth aria-labelledby="tour-title">
      <DialogContent sx={{ pt: 3 }}>
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5, textAlign: "center" }}>
          <Mascot pose={step.pose} height={130} />
          <Typography id="tour-title" variant="h3" sx={{ fontWeight: 800 }}>
            {step.title}
          </Typography>
        </Box>
        <Box sx={{ mt: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
          {step.lines.map((l) => (
            <Typography key={l} variant="body2">
              {l}
            </Typography>
          ))}
          {step.install && <InstallHint />}
        </Box>
        <Box sx={{ display: "flex", justifyContent: "center", gap: 0.75, mt: 2 }} aria-label={`שלב ${i + 1} מתוך ${steps.length}`} role="img">
          {steps.map((_, k) => (
            <Box key={k} sx={{ width: k === i ? 18 : 8, height: 8, borderRadius: 4, bgcolor: k === i ? "secondary.main" : "divider", transition: "width .2s" }} />
          ))}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 2, pb: 2 }}>
        {!last && (
          <Button color="inherit" onClick={close}>
            דלג
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        {i > 0 && <Button onClick={() => setI(i - 1)}>הקודם</Button>}
        <Button variant="contained" onClick={() => (last ? close() : setI(i + 1))} autoFocus>
          {last ? "יאללה, מתחילים" : "הבא"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
