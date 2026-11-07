"""A fictitious base schedule file (לוח הבסיס), laid out like the base's real file.

Same columns, order, rows, dates, duty names, rank texts, instructions and colours
as the sample נע"ת shared; names and phone numbers are invented.

    python tools/make_test_base.py out.xlsx
"""

import sys
from datetime import datetime

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

HEADERS = ["אוכלוסיה", "תאריך התחלה", "תאריך סיום", "חג", "תורנות", "מבצע", "גף", "עתודה", "גף", "דרגות", "הנחיות", "הערות"]

EQUIP = (
    "התייצבות עד השעה 10:00 בבוקר.\n"
    "ציוד נדרש: אפוד, נשק + 5 מחסניות מלאות ב-29 כדורים, , מדי ב' נקיים ותקניים, נעליים צבאיות גבוהות תקניות, "
    "כלי מיטה וציוד אישי (ביגוד חורף בהתאם לעונה)"
)
GUARD = "התייצבות לתדריך ביום שלישי בגף הגנ\"ק בשעה 13:00, התדריכים מעודכנים מידי שבוע בקבוצת הוואצפ. מטווחים בתוקף"
GUARD_NOTES = "מ\"פ החוף דנה לוי - 054-0000001\nמ\"ע שערים יוסי כהן 052-0000002\nחמ\"ל הגנ\"ק : 03-0000000"
GATE = "התייצבות לתדריך בשעה 09:00 ביום שלישי בגף אבטחה פיזית"
GATE_NOTES_S = "מ\"ע שערים יוסי כהן 052-0000002\nחמ\"ל הגנ\"ק - 03-0000000\nש\"ג דרום - רביעי עד חמישי ולא שלישי עד חמישי"
GATE_NOTES_N = "מ\"ע שערים יוסי כהן 052-0000002\nחמ\"ל הגנ\"ק - 03-0000000"
KT = "התייצבות בשעה 09:00 ברס\"ר"
RASAR = "התייצבות ביום רביעי במשק תורנים בשעה 09:00"
RASAR_NOTES = "גיל אברהם 053-0000003"
OFF = "סמל - רס\"ל, סג\"מ - סגן, קמ\"א"
KTR = "רס\"ר-רס\"מ, סרן, קא\"ב"

POP_FILL = {"משימות חיליות": "F4CCCC", "חובה": "C9D3E6", "קצינים ונגדים": "F3E3C3"}
YELLOW, BLUE = "FFFF00", "8EA9DB"

# population, start, end, duty, performer, gaf, reserve, gaf, ranks, instructions, notes, highlight
# highlight: "row" = the whole row yellow, "names" = performer..gaf yellow, "duty+names" also the duty,
#            "blue" = reserve and its gaf in blue
ROWS = [
    ("משימות חיליות", "14/06/2026", "21/06/2026", "אמ\"ת גבעת המורה", "נועה ברק", "תמנע", "", "", "סגן- סרן", EQUIP, "", None),
    ("משימות חיליות", "21/06/2026", "28/06/2026", "אמ\"ת חרבית", "מיכל אדלר", "פעמון", "", "", "סגן- סרן", EQUIP, "", None),
    ("חובה", "22/06/2026", "22/06/2026", "רסר טקס רלצד", "אורי שמש", "פה", "", "", "", "", "", "row"),
    ("חובה", "23/06/2026", "23/06/2026", "רסר טקס רלצד", "רון לוי", "פעמון", "", "", "", "", "", "row"),
    ("חובה", "23/06/2026", "23/06/2026", "רסר טקס רלצד", "עידו שפירא", "רימון", "", "", "", "", "", "row"),
    ("משימות חיליות", "25/06/2026", "25/06/2026", "שיפוט צד", "יעל מזרחי", "תמונא", "", "", "רס\"ן", EQUIP, "", None),
    ("חובה", "28/06/2026", "02/07/2026", "רס\"ר", "שחר דוד", "קרן אור", "איתי נחום", "קרן אור", "כלל הדרגות",
     "תורנות מרלו\"ג , יש להקצות בנים בלבד\nהעבודה בימים ראשון - חמישי בין השעות 08:00-17:00 בכל יום",
     "עומר סגל 050-0000004", "row"),
    ("חובה", "01/07/2026", "08/07/2026", "רס\"ר", "שירה טל", "קרן אור", "עידו שפירא", "רימון", "כלל הדרגות", RASAR, RASAR_NOTES, None),
    ("חובה", "01/07/2026", "08/07/2026", "שמירות חובה", "אריאל פרץ", "רימון", "טל סלומון", "רימון", "כלל הדרגות", GUARD, GUARD_NOTES, "duty+names"),
    ("קצינים ונגדים", "05/07/2026", "07/07/2026", "ש.ג דרום 7-11", "רועי אמסלם", "פה", "קרן וינר", "פה", OFF, GATE, GATE_NOTES_S, None),
    ("קצינים ונגדים", "05/07/2026", "05/07/2026", "קצין תורן", "יוסף קדוש", "תמונא", "נועם כץ", "תמונא", KTR, KT, "", None),
    ("קצינים ונגדים", "06/07/2026", "06/07/2026", "מפקד תורן", "דן יעקובי", "תמונא", "נדב סעדה", "רימון", "רס\"ן, סרן במינוי רס\"ן",
     "זמני התורנות:\nיום א'/ חזרה מחג והדממה - 6 בבוקר עד 8 בבוקר למחרת\nימים ב' - ד' - 08:00-08:00\nיום ה' - 08:00-18:00", "", "names"),
    ("חובה", "08/07/2026", "15/07/2026", "שמירות חובה", "שחר גולן", "פעמון", "רון לוי", "פעמון", "כלל הדרגות", GUARD, GUARD_NOTES, None),
    ("חובה", "08/07/2026", "15/07/2026", "שמירות חובה", "אורן גלבוע", "תמונע", "איתמר גל", "תמונע", "כלל הדרגות", GUARD, GUARD_NOTES, None),
    ("קצינים ונגדים", "09/07/2026", "09/07/2026", "קצין תורן", "נועם כץ", "תמונא", "יוסף קדוש", "תמונא", KTR, KT, "", None),
    ("קצינים ונגדים", "12/07/2026", "12/07/2026", "ממלכת יום", "סער בר", "פעמון", "אור שמריהו", "תמונע",
     "מבצעים אמהות/אבות במשרת הורה, אנשי קבע שעברו ועדת המרות, אנשי קבע בעלי פטור רפואי - כלל הדרגות",
     "ביצוע תדריך טלפוני מול מ\"ג תזונה בשעה 11:00", "איש קשר - מאיה רון 050-0000005", None),
    ("קצינים ונגדים", "14/07/2026", "16/07/2026", "צפון 10-13,16-16", "יובל פנחס", "רימון", "ליאור קרני", "רימון", OFF, GATE, GATE_NOTES_N, None),
    ("חובה", "15/07/2026", "22/07/2026", "שמירות חובה", "רועי פז", "פה", "גל ברון", "פה", "כלל הדרגות", GUARD, GUARD_NOTES, "names"),
    ("חובה", "15/07/2026", "22/07/2026", "רסר הקלת\"ש", "רון לוי", "פעמון", "רון לוי", "פעמון זהב", "ת\"ש 7", RASAR, RASAR_NOTES, None),
    ("קצינים ונגדים", "15/07/2026", "15/07/2026", "קצין תורן", "ספיר גבאי", "תמונע", "דניאל וינר", "תמונע", KTR, KT, "", None),
    ("חובה", "15/07/2026", "22/07/2026", "שמירות חובה", "איתמר גל", "תמונע", "פלג אבן", "תמונע", "כלל הדרגות", GUARD, GUARD_NOTES, "blue"),
    ("קצינים ונגדים", "20/07/2026", "20/07/2026", "קצין תורן", "עומר ברגר", "פה", "ייבג נסים", "פה", KTR, KT, "", None),
]


def build(path: str) -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "לוח תורנויות"
    ws.sheet_view.rightToLeft = True
    thin = Side(style="thin", color="999999")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    wrap = Alignment(horizontal="center", vertical="center", wrap_text=True)

    ws.append(HEADERS)
    for c in ws[1]:
        c.font = Font(bold=True, size=12)
        c.alignment = wrap
        c.border = border
    ws.auto_filter.ref = f"A1:L{len(ROWS) + 1}"
    ws.freeze_panes = "A2"

    for pop, start, end, duty, perf, g1, res, g2, ranks, instr, notes, hl in ROWS:
        ws.append([
            pop,
            datetime.strptime(start, "%d/%m/%Y"),
            datetime.strptime(end, "%d/%m/%Y"),
            "X",
            duty, perf, g1, res, g2, ranks, instr, notes,
        ])
        r = ws.max_row
        for c in ws[r]:
            c.alignment = wrap
            c.border = border
        ws.cell(r, 2).number_format = ws.cell(r, 3).number_format = "dd/mm/yyyy"
        ws.cell(r, 1).fill = PatternFill("solid", fgColor=POP_FILL[pop])
        yellow = PatternFill("solid", fgColor=YELLOW)
        if hl == "row":
            for col in range(1, 13):
                ws.cell(r, col).fill = yellow
        elif hl in ("names", "duty+names"):
            for col in (6, 7, 8, 9) + ((5,) if hl == "duty+names" else ()):
                ws.cell(r, col).fill = yellow
        elif hl == "blue":
            for col in (8, 9):
                ws.cell(r, col).fill = PatternFill("solid", fgColor=BLUE)
        if instr.startswith("תורנות מרלו"):
            ws.cell(r, 11).font = Font(bold=True)
        if "מטווחים בתוקף" in instr:
            ws.cell(r, 11).font = Font(bold=False)

    widths = {"A": 14, "B": 13, "C": 13, "D": 5, "E": 20, "F": 16, "G": 10, "H": 16, "I": 10, "J": 30, "K": 48, "L": 34}
    for col, w in widths.items():
        ws.column_dimensions[col].width = w
    ws.row_dimensions[1].height = 34
    # a note outside the table, as in the original (row 21, column M)
    ws.cell(21, 13, "הופעל")
    wb.save(path)


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else "base-sample.xlsx")
