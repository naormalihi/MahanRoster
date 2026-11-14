import PrintIcon from "@mui/icons-material/PrintOutlined";
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Api } from "../lib/api";
import { HOLIDAY_TYPES, israeliHolidays } from "../lib/catalog";
import { buildSheet, type SheetPage } from "../lib/printSheet";

const monthFmt = new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" });
const stampFmt = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", year: "numeric" });
const dmFmt = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric" });
const WD = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The months to print, each to one A4 landscape sheet (or two halves when it is very full). */
async function loadPages(api: Api, first: Date, count: number): Promise<SheetPage[]> {
  const pages: SheetPage[] = [];
  for (let i = 0; i < count; i++) {
    const from = new Date(first.getFullYear(), first.getMonth() + i, 1);
    const to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
    const rows = await api.board(from.toISOString(), to.toISOString());
    if (!rows.length) continue;
    const days = israeliHolidays(iso(from), iso(to));
    const holidays = new Map(days.map((h) => [h.day, h.note ?? ""]));
    const rest = new Set(days.filter((h) => HOLIDAY_TYPES.has(h.day_type)).map((h) => h.day));
    pages.push(...buildSheet(rows, from.getFullYear(), from.getMonth() + 1, holidays, monthFmt.format(from), rest));
  }
  return pages;
}

const CSS = `
@page { size: A4 landscape; margin: 7mm; }
@media screen { .mr-print { display: none; } }
@media print {
  body > *:not(.mr-print) { display: none !important; }
  .mr-print { display: block; color: #1a1a1a; font-family: inherit; direction: rtl; }
  .mr-print * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
.mr-page { width: 283mm; height: 195mm; display: flex; flex-direction: column; break-after: page; overflow: hidden; }
.mr-page:last-child { break-after: auto; }
.mr-hd { display: flex; align-items: baseline; gap: 3mm; margin-bottom: 2mm; }
.mr-hd h1 { font-size: 15pt; margin: 0; font-weight: 700; }
.mr-hd .s { font-size: 8pt; color: #555; }
.mr-hd .upd { font-size: 8pt; color: #b45309; font-weight: 700; }
.mr-hd .p { margin-inline-start: auto; font-size: 7.5pt; color: #666; }
.mr-page table { border-collapse: collapse; width: 100%; table-layout: fixed; }
.mr-page th, .mr-page td { border: 0.4pt solid #b8b8b8; padding: 0.35mm 1mm; vertical-align: middle; }
.mr-page thead th { background: #f0f0f0; text-align: center; padding: 1mm 0.5mm; line-height: 1.15; }
.mr-page .tn { font-weight: 700; font-size: 7.5pt; }
.mr-page .tt { color: #555; font-size: 6.5pt; }
.mr-page th.d { width: 15mm; background: #f6f6f6; text-align: start; font-weight: 400; line-height: 1.1; }
.mr-page .dd { font-weight: 700; } .mr-page .w { color: #666; margin-inline-start: 1mm; }
.mr-page .hol { display: block; color: #9a3412; font-size: 0.85em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mr-page tr.we > * { background: #fdf1df; }
.mr-page tr.hl > * { background: #fde7d4; }
.mr-page tr.wk > * { border-top: 1.4pt solid #444; }
.mr-page .it { line-height: 1.12; }
.mr-page .it + .it { border-top: 0.3pt dotted #bbb; }
.mr-page .pf { display: flex; gap: 1.2mm; align-items: baseline; white-space: nowrap; overflow: hidden; }
.mr-page .pf b { font-weight: 700; }
.mr-page .r { color: #707070; font-size: 0.86em; overflow: hidden; text-overflow: ellipsis; }
.mr-page .x { color: #555; font-size: 0.86em; }
.mr-page .un { color: #c00; font-weight: 700; }
.mr-ft { font-size: 6.5pt; color: #666; margin-top: 1.2mm; display: flex; gap: 4mm; }
`;

function Sheet({ page, printed }: { page: SheetPage; printed: string }) {
  return (
    <div className="mr-page">
      <div className="mr-hd">
        <h1>לוח תורנויות · {page.title}</h1>
        <span className="s">{page.count} תורנויות</span>
        {page.updated && <span className="upd">עודכן {dmFmt.format(new Date(page.updated))}</span>}
        <span className="p">הודפס {printed} · MahanRoster</span>
      </div>
      <table style={{ fontSize: `${page.fontPt}pt` }}>
        <thead>
          <tr>
            <th className="d">יום</th>
            {page.columns.map((c) => (
              <th key={c.task} style={{ borderTop: `3pt solid ${c.color ?? "#999"}` }}>
                <div className="tn">{c.task}</div>
                <div className="tt">{c.time}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {page.days.map((d) => (
            <tr key={d.day} className={[d.rest ? "hl" : d.weekend ? "we" : "", d.weekStart ? "wk" : ""].join(" ")}>
              <th className="d">
                <span className="dd">{d.date}</span>
                <span className="w">{WD[d.weekday]}</span>
                {d.holiday && <span className="hol">{d.holiday}</span>}
              </th>
              {d.cells.map((items, i) => (
                <td key={i}>
                  {items.map((it, j) => (
                    <div className="it" key={j}>
                      {it.performers.length === 0 ? (
                        <div className="pf">
                          <span className="un">לא מאויש</span>
                          {it.reserves.length > 0 && <span className="r">ע׳ {it.reserves.join(", ")}</span>}
                        </div>
                      ) : (
                        it.performers.map((p, k) => (
                          <div className="pf" key={p}>
                            <b>{p}</b>
                            {k === 0 && it.reserves.length > 0 && <span className="r">ע׳ {it.reserves.join(", ")}</span>}
                          </div>
                        ))
                      )}
                      {it.time && <div className="x">{it.time}</div>}
                    </div>
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mr-ft">
        <span>מודגש = מבצע · ע׳ = עתודה</span>
        <span>שעות בכותרת = השעות הקבועות; שעות אחרות מופיעות בתא</span>
        <span style={{ background: "#fdf1df", padding: "0 1.5mm" }}>סוף שבוע</span>
        <span style={{ background: "#fde7d4", padding: "0 1.5mm" }}>חג</span>
      </div>
    </div>
  );
}

/** Print: the month sheets, or what the screen shows (e.g. the week table). */
export function PrintDialog({ api, month, onClose, onPrintScreen }: { api: Api; month: Date; onClose: () => void; onPrintScreen: () => void }) {
  const [count, setCount] = useState(1);
  const [pages, setPages] = useState<SheetPage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // the sheets are in the page only for the print job
  useEffect(() => {
    if (!pages) return;
    const done = () => {
      setPages(null);
      onClose();
    };
    window.addEventListener("afterprint", done, { once: true });
    const t = setTimeout(() => window.print(), 50);
    return () => {
      clearTimeout(t);
      window.removeEventListener("afterprint", done);
    };
  }, [pages, onClose]);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const p = await loadPages(api, month, count);
      if (!p.length) setError("אין תורנויות מפורסמות בחודשים האלה.");
      else setPages(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const printed = stampFmt.format(new Date());
  return (
    <>
      <Dialog open={!pages} onClose={onClose} maxWidth="xs" fullWidth>
        <DialogTitle>הדפסת הלוח</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              כל חודש בדף A4 אחד לרוחב: הימים בשורות, התורנויות בעמודות. חודש עמוס במיוחד מתחלק לשני דפים כדי שיישאר קריא.
            </Typography>
            <TextField select label="מה להדפיס" value={count} onChange={(e) => setCount(Number(e.target.value))} fullWidth>
              {[1, 2, 3, 6].map((n) => (
                <MenuItem key={n} value={n}>
                  {n === 1
                    ? monthFmt.format(month)
                    : `${n} חודשים, מ${monthFmt.format(month)} עד ${monthFmt.format(new Date(month.getFullYear(), month.getMonth() + n - 1, 1))}`}
                </MenuItem>
              ))}
            </TextField>
            {error && <Alert severity="info">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ justifyContent: "space-between" }}>
          <Button
            onClick={() => {
              onClose();
              onPrintScreen();
            }}
          >
            הדפסת התצוגה במסך
          </Button>
          <Stack direction="row" spacing={1}>
            <Button onClick={onClose}>ביטול</Button>
            <Button variant="contained" startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <PrintIcon />} disabled={busy} onClick={() => void go()}>
              הדפסה
            </Button>
          </Stack>
        </DialogActions>
      </Dialog>
      {pages &&
        createPortal(
          <div className="mr-print">
            <style>{CSS}</style>
            {pages.map((p, i) => (
              <Sheet key={i} page={p} printed={printed} />
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
