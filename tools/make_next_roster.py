"""The next HR export after make_test_roster.py: the same soldiers half a year later.

Reads the previous roster file and writes the next one with the changes a real export
would show, and a second file listing every change (for checking the import preview):
released soldiers gone from the file, soldiers who moved to career service (career start
date in the past), promotions, release dates moved, gaf transfers, parent status started
or ended, a name change, and new soldiers. All names and numbers are invented.

    python tools/make_next_roster.py prev.xlsx next.xlsx changes.xlsx
"""

import random
from copy import copy
import sys
from datetime import date, datetime, timedelta

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

prev, out, changes_out = sys.argv[1], sys.argv[2], sys.argv[3]
rnd = random.Random(20270701)
CYCLE_START = date(2027, 7, 1)
IMPORT_DAY = date(2026, 11, 14)  # career start on or before the import day = career service

wb = load_workbook(prev)
ws = wb.active
headers = [c.value for c in ws[1]]
col = {h: i for i, h in enumerate(headers)}
rows = [list(r) for r in ws.iter_rows(min_row=2, values_only=True)]
R, PN, FIRST, LAST, FRAME = col["דרגה מחושבת"], col["מספר עובד"], col["שם פרטי"], col["שם משפחה"], col["מסגרת"]
END, CAREER, ELIG = col['תאריך תום שירות (תש"ש)'], col["תאריך כניסה לקבע"], col["תאריך זכאות לדרגה מחושבת"]
PARENT, PARENT_END, NOTE, AGE, GENDER = col["נמצא במשרת הורה"], col["תאריך סיום - הורה"], col["הערות"], col["גיל"], col["מין"]
d = lambda v: v.date() if isinstance(v, datetime) else v
dt = lambda v: datetime.combine(v, datetime.min.time())
name = lambda r: f"{r[FIRST]} {r[LAST]}"
fmt = lambda v: d(v).strftime("%d/%m/%Y") if v else "—"

log: list[tuple[str, str, str, str, str]] = []  # kind, pn, name, before, after
MANDATORY = {"סמל", 'סמ"ר'}
for r in rows:
    r[AGE] = round(r[AGE] + 0.6, 1)

# 1. Mandatory soldiers whose service ended before the cycle: most are released (gone from
#    the file); a few signed and moved to career service already.
ending = sorted((r for r in rows if r[R] in MANDATORY and d(r[END]) < CYCLE_START), key=lambda r: d(r[END]))
signed = ending[:4]
for r in signed:
    old_end, old_start = r[END], r[CAREER]
    r[END] = dt(IMPORT_DAY - timedelta(days=rnd.randint(8, 40)))
    r[CAREER] = dt(d(r[END]) + timedelta(days=1))
    r[NOTE] = "עבר לקבע"
    log.append(("עבר לקבע", r[PN], name(r), f"חובה · תש\"ש {fmt(old_end)} · קבע מ-{fmt(old_start)}", f"קבע מ-{fmt(r[CAREER])} (תש\"ש {fmt(r[END])})"))
released = ending[4:]
# and two career soldiers who retired
released += rnd.sample([r for r in rows if r[R] in {'רס"ר', 'סא"ל', 'רס"ן'}], 2)
for r in released:
    log.append(("השתחרר – לא בקובץ", r[PN], name(r), f"{r[R]} · תש\"ש {fmt(r[END])}", "לא מופיע בקובץ"))
rows = [r for r in rows if r not in released]

# 2. Release date inside the cycle (mid-cycle release) and service extensions
pool = [r for r in rows if r[R] in MANDATORY and r not in signed and d(r[END]) > date(2027, 12, 31)]
for r in rnd.sample(pool, 3):
    old = r[END]
    r[END] = dt(date(2027, rnd.choice([8, 9, 10, 11]), rnd.randint(1, 28)))
    r[CAREER] = dt(d(r[END]) + timedelta(days=1))
    log.append(("תאריך שחרור בתוך המחזור", r[PN], name(r), fmt(old), fmt(r[END])))
for r in rnd.sample([r for r in rows if r[R] in MANDATORY and r not in signed and CYCLE_START <= d(r[END]) <= date(2027, 12, 31)], 2):
    old = r[END]
    r[END] = dt(d(r[END]) + timedelta(days=rnd.randint(120, 300)))
    r[CAREER] = dt(d(r[END]) + timedelta(days=1))
    log.append(("הארכת שירות", r[PN], name(r), fmt(old), fmt(r[END])))

# 3. Promotions (rank eligibility date passed)
PROMO = [("סמל", 'סמ"ר', 6), ("סגן", "סרן", 3), ("סרן", 'רס"ן', 2), ('רס"ל', 'רס"ר', 2), ('רס"ר', 'רס"מ', 1), ('סמ"ר', 'רס"ל', 0)]
promoted: list = []
for a, b, n in PROMO:
    cands = [r for r in rows if r[R] == a and r not in signed and r not in promoted]
    for r in rnd.sample(cands, min(n, len(cands))):
        r[R] = b
        promoted.append(r)
        r[ELIG] = dt(CYCLE_START + timedelta(days=rnd.randint(200, 700)))
        log.append(("קידום בדרגה", r[PN], name(r), a, b))
# the soldiers who moved to career service also went up to רס"ל
for i, r in enumerate(signed):
    old = r[R]
    r[R] = 'רס"ל' if i < 2 else 'סמ"ר'
    if r[R] != old:
        log.append(("קידום בדרגה", r[PN], name(r), old, r[R]))

# 4. Gaf transfers
GAFIM = {
    "גף ענן": ["צוות תשתיות", "צוות DevOps", "צוות אבטחה"],
    "גף פיתוח": ["צוות אפליקציות", "צוות ממשקים", "צוות דאטה"],
    "גף בדיקות": ["צוות אוטומציה", "צוות ביצועים"],
    "גף מערכות": ["צוות מערכות מידע", "צוות תמיכה"],
}
gaf_of = lambda r: r[FRAME].split("/")[1]
for r in rnd.sample(rows, 3):
    old = gaf_of(r)
    new = rnd.choice([g for g in GAFIM if g != old])
    r[FRAME] = f"מה\"ן - מלמסים/{new}/{rnd.choice(GAFIM[new])} - מלמסים"
    log.append(("מעבר גף", r[PN], name(r), old, new))

# 5. Parent status: two ended, two started
for r in rnd.sample([r for r in rows if r[PARENT] == "YES"], 2):
    old = r[PARENT_END]
    r[PARENT], r[PARENT_END] = None, None
    log.append(("סיום משרת הורה", r[PN], name(r), f"הורה עד {fmt(old)}", "לא"))
for r in rnd.sample([r for r in rows if r[PARENT] != "YES" and r[R] not in MANDATORY], 2):
    r[PARENT], r[PARENT_END] = "YES", dt(date(2028, rnd.randint(1, 12), 15))
    r[col["מספר ילדים"]] = (r[col["מספר ילדים"]] or 0) + 1
    log.append(("התחלת משרת הורה", r[PN], name(r), "לא", f"הורה עד {fmt(r[PARENT_END])}"))

# 6. A name change
r = rnd.choice([r for r in rows if r[GENDER] == "נקבה" and r[R] not in MANDATORY])
old = name(r)
r[LAST] = "אלמוג"
log.append(("שינוי שם", r[PN], name(r), old, name(r)))

# 7. New soldiers: recruits and two career transfers
used = {r[PN] for r in rows} | {r[PN] for r in released}
def pn():
    """An invented 9-digit employee number (מספר עובד) with a valid check digit."""
    while True:
        body = "".join(str(rnd.randint(0, 9)) for _ in range(8))
        s = sum((d := int(c) * (i % 2 + 1)) - 9 * (d > 9) for i, c in enumerate(body))
        v = body + str((10 - s % 10) % 10)
        if v not in used:
            used.add(v)
            return v
FIRST_M = ["איתן", "אביב", "רז", "ינון", "אלעד", "שגיא", "עוז", "הראל"]
FIRST_F = ["אגם", "ליבי", "שני", "גלי", "אלה", "רותם"]
SURNAMES = ["אוחיון", "בן דוד", "גולן", "טל", "יוסף", "מלכה", "סויסה", "עזרא", "קדוש", "רביבו"]
NEW = [("טוראי", 5), ('רב"ט', 4), ("סמל", 3), ('סג"מ', 1), ("סרן", 1)]
for rank, n in NEW:
    for _ in range(n):
        female = rnd.random() < 0.4
        gaf = rnd.choice(list(GAFIM))
        mandatory = rank in {"טוראי", 'רב"ט', "סמל"}
        end = date(2029, rnd.randint(1, 12), rnd.randint(1, 28)) if mandatory else date(2030, rnd.randint(1, 12), 1)
        start = end + timedelta(days=1) if mandatory else IMPORT_DAY - timedelta(days=rnd.randint(200, 900))
        r = [None] * len(headers)
        r[PN], r[GENDER], r[R] = pn(), "נקבה" if female else "זכר", rank
        r[FIRST], r[LAST] = rnd.choice(FIRST_F if female else FIRST_M), rnd.choice(SURNAMES)
        r[FRAME] = f"מה\"ן - מלמסים/{gaf}/{rnd.choice(GAFIM[gaf])} - מלמסים"
        r[col["יחידת סיפוח"]] = 21
        r[col["עיסוק מיועד"]], r[col["עיסוק מיועד קוד"]] = ("מתכנת", 19149) if mandatory else ("תפקיד קצין", 1)
        r[ELIG], r[END], r[CAREER] = dt(CYCLE_START + timedelta(days=rnd.randint(60, 400))), dt(end), dt(start)
        r[col["מספר ילדים"]], r[col["פרופיל"]], r[AGE] = 0, rnd.choice([97, 82, 72]), round(rnd.uniform(18.5, 20) if mandatory else rnd.uniform(22, 30), 1)
        r[NOTE] = "חייל חדש" if mandatory else "הגיע מיחידה אחרת"
        rows.append(r)
        log.append(("חדש", r[PN], name(r), "—", f"{rank} · {'חובה' if mandatory else 'קבע'} · {gaf}"))

rnd.shuffle(rows)

# write the roster in the same layout as the previous file
nb = Workbook()
ns = nb.active
ns.title = ws.title
ns.sheet_view.rightToLeft = True
ns.append(headers)
for r in rows:
    ns.append(r)
for i in range(1, len(headers) + 1):
    src = ws.cell(1, i)
    dst = ns.cell(1, i)
    dst.font, dst.fill, dst.alignment, dst.border = copy(src.font), copy(src.fill), copy(src.alignment), copy(src.border)
    ns.column_dimensions[get_column_letter(i)].width = ws.column_dimensions[get_column_letter(i)].width
ns.row_dimensions[1].height = 42
for row in ns.iter_rows(min_row=2):
    for c in row:
        if hasattr(c.value, "year"):
            c.number_format = "DD/MM/YYYY"
ns.auto_filter.ref = ns.dimensions
ns.freeze_panes = "B2"
nb.save(out)

# the list of changes
order = ["השתחרר – לא בקובץ", "עבר לקבע", "תאריך שחרור בתוך המחזור", "הארכת שירות", "קידום בדרגה", "מעבר גף", "התחלת משרת הורה", "סיום משרת הורה", "שינוי שם", "חדש"]
log.sort(key=lambda x: (order.index(x[0]), x[2]))
cb = Workbook()
cs = cb.active
cs.title = "שינויים"
cs.sheet_view.rightToLeft = True
cs.append(["סוג שינוי", "מספר עובד", "שם", "לפני", "אחרי"])
for c in cs[1]:
    c.font, c.fill = Font(bold=True), PatternFill("solid", fgColor="C9C6EE")
for x in log:
    cs.append(list(x))
for c, w in zip("ABCDE", (24, 12, 18, 40, 40)):
    cs.column_dimensions[c].width = w
for row in cs.iter_rows():
    for c in row:
        c.alignment = Alignment(wrap_text=True, vertical="center")
cb.save(changes_out)

from collections import Counter
print(len(rows), "soldiers →", out)
for k, v in Counter(x[0] for x in log).items():
    print(f"  {k}: {v}")
