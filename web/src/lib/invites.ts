/**
 * Handing out join codes: a WhatsApp message per soldier, and a printed sheet per gaf with a
 * QR code that opens the join form with the code already filled in. Plain functions, so the
 * texts and the sheet can be tested without a browser.
 */

export interface InviteRow {
  id: string;
  full_name: string;
  gaf_name: string;
  code: string;
  /** 9725XXXXXXXX: WhatsApp opens his chat; without it, the contact picker */
  phone?: string | null;
}

/** The join form, with the code filled in. */
export const joinLink = (origin: string, code: string) => `${origin}/?join=1&code=${encodeURIComponent(code)}`;

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full;

export function whatsappText(row: InviteRow, origin: string): string {
  return [
    `היי ${firstName(row.full_name)}, זה הקוד האישי שלך להצטרפות לתורנצ׳יק – מערכת התורנויות של היחידה:`,
    "",
    row.code,
    "",
    `נכנסים כאן (הקוד כבר ממולא): ${joinLink(origin, row.code)}`,
    "בוחרים שם משתמש וסיסמה – ומשם רואים את התורנויות שלך, מגישים בקשות ומקבלים תזכורות.",
  ].join("\n");
}

/** wa.me with the text and no number: WhatsApp opens the contact picker (the system keeps no phone numbers). */
export const whatsappUrl = (text: string, phone?: string | null) =>
  `https://wa.me/${phone && /^9725\d{8}$/.test(phone) ? phone : ""}?text=${encodeURIComponent(text)}`;

/** One group per gaf, soldiers by name. */
export function byGaf(rows: InviteRow[]): { gaf: string; rows: InviteRow[] }[] {
  const m = new Map<string, InviteRow[]>();
  for (const r of rows) m.set(r.gaf_name || "בלי מסגרת", [...(m.get(r.gaf_name || "בלי מסגרת") ?? []), r]);
  return [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "he"))
    .map(([gaf, rs]) => ({ gaf, rows: rs.sort((a, b) => a.full_name.localeCompare(b.full_name, "he")) }));
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The printed sheet: a page per gaf, a card per soldier to cut out (qr: code → image data URL). */
export function printHtml(rows: InviteRow[], qr: Map<string, string>, origin: string, expires: string): string {
  const pages = byGaf(rows)
    .map(
      (g) => `<section class="page"><h1>קודי הצטרפות – ${esc(g.gaf)}</h1>
<p class="note">כל עובד מקבל את הכרטיס שלו. סורקים את הקוד בטלפון, או נכנסים ל-<span dir="ltr">${esc(origin)}</span> ← "יש לי קוד הצטרפות". בתוקף עד ${esc(expires)}.</p>
<div class="cards">${g.rows
        .map(
          (r) => `<div class="card"><img src="${qr.get(r.code) ?? ""}" alt="" /><div><div class="name">${esc(r.full_name)}</div><div class="code" dir="ltr">${esc(r.code)}</div><div class="hint">תורנצ׳יק · קוד אישי, חד-פעמי</div></div></div>`,
        )
        .join("")}</div></section>`,
    )
    .join("");
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>קודי הצטרפות</title><style>
@page { size: A4; margin: 12mm; }
body { font-family: Arial, sans-serif; margin: 0; color: #111; }
.page { page-break-after: always; }
.page:last-child { page-break-after: auto; }
h1 { font-size: 18pt; margin: 0 0 4mm; }
.note { font-size: 10pt; margin: 0 0 6mm; color: #333; }
.cards { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
.card { display: flex; gap: 4mm; align-items: center; border: 1px dashed #999; padding: 4mm; break-inside: avoid; }
.card img { width: 28mm; height: 28mm; }
.name { font-size: 13pt; font-weight: bold; }
.code { font-family: monospace; font-size: 16pt; font-weight: bold; letter-spacing: 1px; margin: 1mm 0; text-align: right; }
.hint { font-size: 8pt; color: #555; }
</style></head><body>${pages}</body></html>`;
}
