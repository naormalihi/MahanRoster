"""Fictitious roster file in the layout of the unit's HR export (for testing the import).

Every name, personal number and detail is invented. Personal numbers start with 9
followed by six random digits and do not belong to anyone.
"""

import random
import sys
from datetime import date, timedelta

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation  # noqa: F401 (kept for parity with real file)

rnd = random.Random(20261107)
out = sys.argv[1]

FIRST_M = ["איתי", "יונתן", "עומר", "נדב", "אורי", "גיא", "אלון", "דניאל", "רועי", "עידו", "יואב", "תומר", "אסף", "ליאור", "עמית", "שחר", "בן", "אריאל", "נועם", "מתן"]
FIRST_F = ["נועה", "מאיה", "שירה", "תמר", "הילה", "ליה", "עדי", "רוני", "יעל", "מיכל", "אור", "טל", "שקד", "אביגיל", "ענבר", "הדר"]
LAST = ["כהן", "לוי", "מזרחי", "פרץ", "ביטון", "אברהם", "פרידמן", "שושן", "אזולאי", "דהן", "חדד", "גבאי", "רוזן", "קפלן", "אדלר", "ברק", "שלו", "נחום", "סגל", "וקנין"]
GAFIM = {
    "גף ענן": ["צוות תשתיות", "צוות DevOps", "צוות אבטחה"],
    "גף פיתוח": ["צוות אפליקציות", "צוות ממשקים", "צוות דאטה"],
    "גף בדיקות": ["צוות אוטומציה", "צוות ביצועים"],
    "גף מערכות": ["צוות מערכות מידע", "צוות תמיכה"],
}
OCC = [("מתכנת", 19149), ("בודק תוכנה", 690), ("מהנדס מערכות מידע", 19157), ("תפקיד קצין", 1), ("מנתח מערכות", 1233), ("איש DevOps", 1800)]
PROFILES = [97, 97, 82, 82, 72, 64, 45]

# rank, how many, age range, years to end of service (תש"ש), notes
GROUPS = [
    ('סמל', 18, (19, 21), (0.5, 2.0), "חובה רגיל"),
    ('סמ"ר', 22, (20, 22), (0.2, 1.5), "חובה רגיל"),
    ('קמ"א', 16, (21, 26), (2.0, 5.0), "קמא רגיל"),
    ('רס"ל', 14, (22, 30), (1.0, 6.0), "רסל רגיל"),
    ('רס"ר', 8, (25, 35), (2.0, 8.0), "רסר רגיל"),
    ('סגן', 10, (22, 26), (1.0, 4.0), "קצין רגיל"),
    ('סרן', 10, (24, 32), (1.0, 6.0), "קצין רגיל"),
    ('רס"ן', 8, (28, 40), (2.0, 10.0), "רסן רגיל"),
    ('סא"ל', 2, (35, 45), (2.0, 8.0), "סאל"),
]
OFFICER = {"סגן", "סרן", 'רס"ן', 'סא"ל', 'קמ"א'}
TODAY = date(2026, 11, 7)

HEADERS = [
    "מספר אישי", "מין", "דרגה מחושבת", "שם פרטי", "שם משפחה", "מסגרת", "יחידת סיפוח", "עיסוק מיועד",
    "עיסוק מיועד קוד", "תאריך זכאות לדרגה מחושבת", "תאריך תום שירות (תש\"ש)", "תאריך כניסה לקבע", "נמצא במשרת הורה",
    "תאריך סיום - הורה", "מספר ילדים", "מתנדב", "פרופיל", "גיל",
    "ק. הגנ\"ש", "ק. תורן", "מפקד שער", "מפקד תורן", "ממלכת יום", "משימות חיילות", "הערות",
]

used = set()


def pn():
    while True:
        v = "9" + "".join(str(rnd.randint(0, 9)) for _ in range(6))
        if v not in used:
            used.add(v)
            return v


rows = []
for rank, n, ages, svc, note in GROUPS:
    for _ in range(n):
        female = rnd.random() < 0.38
        first = rnd.choice(FIRST_F if female else FIRST_M)
        gaf = rnd.choice(list(GAFIM))
        team = rnd.choice(GAFIM[gaf])
        occ, code = rnd.choice(OCC[:3] + OCC[4:]) if rank not in OFFICER else rnd.choice([OCC[3], OCC[2], OCC[0]])
        age = round(rnd.uniform(*ages), 1)
        end = TODAY + timedelta(days=int(365 * rnd.uniform(*svc)))
        eligible = TODAY + timedelta(days=rnd.randint(-200, 600))
        parent = rank in {'רס"ל', 'רס"ר', "סרן", 'רס"ן', 'סא"ל'} and rnd.random() < 0.18
        parent_until = (TODAY + timedelta(days=rnd.randint(60, 700))) if parent else None
        kids = rnd.choice([1, 2, 3]) if parent else (rnd.choice([0, 0, 0, 1]) if age > 27 else 0)
        profile = rnd.choice(PROFILES)
        # The HR file always has a career start date. Mandatory soldiers carry the planned
        # date (day after end of service, so it is in the future); a few career soldiers
        # signed but start later.
        if rank in {"סמל", 'סמ"ר', 'קמ"א'} or (rank == "סגן" and rnd.random() < 0.5):
            career_start = end + timedelta(days=1)
        elif rnd.random() < 0.06:
            career_start = TODAY + timedelta(days=rnd.randint(20, 120))
        else:
            career_start = TODAY - timedelta(days=int(365 * rnd.uniform(0.3, max(0.5, age - 21))))
        availability = 0.67 if rnd.random() < 0.05 else 1
        av = availability
        # potential matrix (1 / 0.67 / empty) – mirrors the eligibility the system will compute itself
        mandatory = rank in {"סמל", 'סמ"ר'}
        cells = {
            "ק. הגנ\"ש": av if rank in {"סגן", "סרן", 'קמ"א'} else None,
            "ק. תורן": av if rank in {"סגן", "סרן", 'רס"ן'} else None,
            "מפקד שער": av if rank in {'רס"ל', 'רס"ר', 'קמ"א'} else None,
            "מפקד תורן": av if rank in {'רס"ר', 'רס"ן', 'סא"ל'} else None,
            "ממלכת יום": av if parent else None,
            "משימות חיילות": av if mandatory and female else None,
        }
        if parent:
            cells = {k: (av if k == "ממלכת יום" else None) for k in cells}
            note = f"משרת הורה, {rank.replace(chr(34), '')}"
        elif availability < 1:
            note = f"{note.split()[0]} 0.67 חל\"ת חודשיים"
        else:
            note = [g[4] for g in GROUPS if g[0] == rank][0]
        rows.append([
            pn(), "נקבה" if female else "זכר", rank, first, rnd.choice(LAST),
            f"מה\"ן - מלמסים/{gaf}/{team} - מלמסים", rnd.choice([21, 21, 34, 57]), occ, code,
            eligible, end, career_start, "YES" if parent else None, parent_until, kids,
            "כן" if rnd.random() < 0.05 else None, profile, age,
            *cells.values(), note,
        ])

rnd.shuffle(rows)

wb = Workbook()
ws = wb.active
ws.title = "כ\"א"
ws.sheet_view.rightToLeft = True
ws.append(HEADERS)
for r in rows:
    ws.append(r)

head_fill = PatternFill("solid", fgColor="C9C6EE")
thin = Side(style="thin", color="9A97C9")
for c in ws[1]:
    c.fill = head_fill
    c.font = Font(bold=True)
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    c.border = Border(top=thin, bottom=thin, left=thin, right=thin)
ws.row_dimensions[1].height = 42
widths = [11, 7, 9, 10, 11, 52, 9, 18, 9, 13, 13, 13, 9, 12, 7, 7, 7, 6, 7, 7, 7, 7, 7, 8, 24]
for i, w in enumerate(widths, start=1):
    ws.column_dimensions[get_column_letter(i)].width = w
for row in ws.iter_rows(min_row=2):
    for c in row:
        if hasattr(c.value, "year"):
            c.number_format = "DD/MM/YYYY"
ws.auto_filter.ref = ws.dimensions
ws.freeze_panes = "B2"
wb.save(out)
print(len(rows), "rows ->", out)
