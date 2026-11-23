import CheckIcon from "@mui/icons-material/Check";
import CopyIcon from "@mui/icons-material/ContentCopy";
import DownloadIcon from "@mui/icons-material/DownloadOutlined";
import PrintIcon from "@mui/icons-material/PrintOutlined";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useAuth } from "../lib/auth";
import { printHtml, whatsappText, whatsappUrl } from "../lib/invites";

interface Person {
  id: string;
  full_name: string;
  gaf_name: string;
  phone?: string | null;
}

/**
 * Join codes for the chosen soldiers. Each code is shown here once (the system keeps only a
 * hash): download the list or copy it, and hand every soldier his own code.
 */
export function InviteDialog(props: { soldiers: Person[]; hasAccount: (id: string) => boolean; onClose: () => void; onDone: () => void }) {
  const { api } = useAuth();
  const [days, setDays] = useState(30);
  const [codes, setCodes] = useState<{ soldier_id: string; code: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const eligible = props.soldiers.filter((s) => !props.hasAccount(s.id));
  const skipped = props.soldiers.length - eligible.length;
  const byId = new Map(props.soldiers.map((s) => [s.id, s]));
  const join = `${window.location.origin}/?join=1`;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      setCodes(await api!.createSoldierInvites(eligible.map((s) => s.id), days));
      props.onDone();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  const rows = (codes ?? []).map((c) => ({ ...byId.get(c.soldier_id)!, code: c.code }));
  const origin = window.location.origin;
  const expires = new Date(Date.now() + days * 86_400_000).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });

  // handed out: remembered on the server so the soldiers screen tells who still waits for a code
  function markSent(ids: string[]) {
    setSent((s) => new Set([...s, ...ids]));
    api!.markInvitesSent(ids).catch(() => undefined);
  }

  async function printSheet() {
    const QR = await import("qrcode");
    const qr = new Map<string, string>();
    for (const r of rows) qr.set(r.code, await QR.toDataURL(`${origin}/?join=1&code=${encodeURIComponent(r.code)}`, { margin: 1, width: 240 }));
    const w = window.open("", "_blank");
    if (!w) return setError("הדפדפן חסם את חלון ההדפסה – אפשר חלונות קופצים לאתר ונסה שוב");
    w.document.write(printHtml(rows, qr, origin, expires));
    w.document.close();
    setTimeout(() => w.print(), 600);
    markSent(rows.map((r) => r.id));
  }
  const text = rows.map((r) => `${r.full_name} (${r.gaf_name}): ${r.code}`).join("\n");

  async function download() {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([["שם", "מסגרת", "קוד הצטרפות"], ...rows.map((r) => [r.full_name, r.gaf_name, r.code])]);
    ws["!cols"] = [{ wch: 22 }, { wch: 16 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, "קודי הצטרפות");
    XLSX.writeFile(wb, "קודי הצטרפות.xlsx");
  }

  return (
    <Dialog open onClose={props.onClose} maxWidth="sm" fullWidth>
      <DialogTitle>קודי הצטרפות</DialogTitle>
      <DialogContent dividers>
        {!codes ? (
          <Stack spacing={2}>
            <Typography variant="body2">
              לכל עובד קוד אישי חד-פעמי. העובד נכנס לאתר, בוחר "יש לי קוד הצטרפות", מקליד את הקוד ובוחר שם משתמש וסיסמה. אחרי זה הוא רואה את
              המשימות שלו, למה שובץ והניקוד שלו מול הממוצע.
            </Typography>
            <Typography variant="body2">
              ייווצרו קודים ל-<b>{eligible.length}</b> עובדים
              {skipped ? ` (${skipped} כבר עם חשבון – בלי קוד)` : ""}. קוד חדש מבטל קוד קודם של אותו עובד.
            </Typography>
            <TextField select label="תוקף" value={days} onChange={(e) => setDays(Number(e.target.value))} sx={{ maxWidth: 200 }}>
              {[7, 14, 30, 60].map((d) => (
                <MenuItem key={d} value={d}>
                  {d} ימים
                </MenuItem>
              ))}
            </TextField>
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        ) : (
          <Stack spacing={2}>
            <Alert severity="warning">
              הקודים מוצגים <b>פעם אחת בלבד</b> – המערכת שומרת רק טביעה שלהם. שלח, הדפס או הורד אותם לפני הסגירה.
            </Alert>
            <Typography variant="body2" color="text.secondary">
              כפתור הוואטסאפ פותח הודעה מוכנה עם הקוד וקישור שממלא אותו – ישר בצ׳אט של העובד אם יש לו טלפון במערכת, ואחרת בוחרים אותו באנשי הקשר. ההדפסה מוציאה דף לכל מסגרת עם כרטיס וקוד QR לכל
              עובד. מה שנשלח או הודפס מסומן במסך העובדים.
            </Typography>
            {error && <Alert severity="error">{error}</Alert>}
            <Typography variant="body2">
              כתובת ההצטרפות: <Box component="span" dir="ltr">{join}</Box>
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>שם</TableCell>
                  <TableCell>מסגרת</TableCell>
                  <TableCell>קוד</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.full_name}</TableCell>
                    <TableCell>
                      {r.gaf_name}
                      {!r.phone && (
                        <Typography variant="caption" color="warning.main" sx={{ display: "block" }}>
                          אין טלפון
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell dir="ltr" sx={{ fontFamily: "monospace", fontWeight: 700, textAlign: "start", whiteSpace: "nowrap" }}>
                      {r.code}
                    </TableCell>
                    <TableCell padding="none" sx={{ whiteSpace: "nowrap" }}>
                      <Tooltip title={`${sent.has(r.id) ? "נשלח – שליחה שוב" : `שליחה ל${r.full_name} בוואטסאפ`}${r.phone ? "" : " · אין טלפון: בוחרים איש קשר"}`}>
                        <IconButton
                          component="a"
                          href={whatsappUrl(whatsappText(r, origin), r.phone)}
                          target="_blank"
                          rel="noopener"
                          onClick={() => markSent([r.id])}
                          aria-label={`שליחת הקוד ל${r.full_name} בוואטסאפ`}
                          sx={{ color: sent.has(r.id) ? "success.main" : "#25D366" }}
                        >
                          {sent.has(r.id) ? <CheckIcon /> : <WhatsAppIcon />}
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {!codes ? (
          <>
            <Button onClick={props.onClose}>ביטול</Button>
            <Button variant="contained" onClick={create} disabled={busy || eligible.length === 0}>
              יצירת קודים
            </Button>
          </>
        ) : (
          <>
            <Button
              startIcon={<CopyIcon />}
              onClick={async () => {
                await navigator.clipboard.writeText(`הצטרפות למערכת המשימות: ${join}\n\n${text}`);
                setCopied(true);
              }}
            >
              {copied ? "הועתק" : "העתקה"}
            </Button>
            <Button startIcon={<PrintIcon />} onClick={printSheet}>
              הדפסה לפי מסגרת
            </Button>
            <Button startIcon={<DownloadIcon />} onClick={download}>
              הורדת קובץ
            </Button>
            <Button variant="contained" onClick={props.onClose}>
              סגירה
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
