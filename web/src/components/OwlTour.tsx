import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, FormControlLabel, Typography } from "@mui/material";
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

/** Short steps from the owl. Going through to the end, or ticking "הבנתי, אל תציג לי שוב", stops it
 *  opening by itself; skipping without the tick lets it open again at the next sign-in. */
export function OwlTour({ open, steps, onClose, onFeedback }: { open: boolean; steps: TourStep[]; onClose: (dismiss: boolean) => void; onFeedback?: () => void }) {
  const [i, setI] = useState(0);
  const [enough, setEnough] = useState(false);
  const step = steps[Math.min(i, steps.length - 1)];
  const last = i >= steps.length - 1;
  const close = (done = false) => {
    onClose(done || enough);
    setTimeout(() => {
      setI(0);
      setEnough(false);
    }, 300);
  };
  if (!step) return null;
  return (
    <Dialog open={open} onClose={() => close()} maxWidth="xs" fullWidth aria-labelledby="tour-title">
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
        {!last && (
          <Box sx={{ display: "flex", justifyContent: "center", mt: 1 }}>
            <FormControlLabel
              control={<Checkbox size="small" checked={enough} onChange={(e) => setEnough(e.target.checked)} />}
              label={<Typography variant="body2" color="text.secondary">הבנתי, אל תציג לי שוב</Typography>}
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 2, pb: 2 }}>
        {last && onFeedback && (
          <Button onClick={onFeedback} sx={{ marginInlineEnd: "auto" }}>
            יש לך רעיון? הצעה לשיפור
          </Button>
        )}
        {!last && (
          <Button color="inherit" onClick={() => close()}>
            דלג
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        {i > 0 && <Button onClick={() => setI(i - 1)}>הקודם</Button>}
        <Button variant="contained" onClick={() => (last ? close(true) : setI(i + 1))} autoFocus>
          {last ? "יאללה, מתחילים" : "הבא"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
