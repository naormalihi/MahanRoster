"""A fictitious base schedule (לוח הבסיס) for a whole cycle, in the base's file layout.

The rhythm of each duty follows the sample from the base: weekly guard and רס"ר duties
Wednesday to Wednesday, week-long soldier tasks Sunday to Sunday, single days of קצין
תורן / מפקד תורן / ממלכת יום, 3-day gate duties, an occasional ceremony. The performer,
reserve and gaf columns are empty – this is the file before scheduling. The "חג" column
has X on every duty that does not touch a holiday or holiday eve.

    python tools/make_base_cycle.py 2027-01-01 2027-06-30 out.xlsx
"""

import random
import sys
from datetime import date, datetime, timedelta

from make_test_base import EQUIP, GATE, GATE_NOTES_N, GATE_NOTES_S, GUARD, GUARD_NOTES, KT, KTR, OFF, RASAR, RASAR_NOTES, write

# Holidays and holiday eves (Israel) – from the app's Hebrew calendar for 2027.
HOLIDAYS = {date(2027, 4, 21), date(2027, 4, 22), date(2027, 4, 27), date(2027, 4, 28), date(2027, 5, 12), date(2027, 6, 10), date(2027, 6, 11)}

def dow(d: date) -> int:
    """0 = Sunday … 6 = Saturday."""
    return d.isoweekday() % 7


def days(a: date, b: date):
    d = a
    while d <= b:
        yield d
        d += timedelta(days=1)


def build_rows(start: date, end: date, seed: int = 27):
    rnd = random.Random(seed)
    rows = []

    def add(pop, a, b, duty, ranks, instr, notes, hl=None):
        if a < start or a > end:
            return  # a slot belongs to the cycle it starts in
        holiday = any(d in HOLIDAYS for d in days(a, b))
        rows.append((pop, a, b, holiday, duty, ranks, instr, notes, hl))

    # Wednesday → Wednesday: 3 guard rows, רס"ר, רס"ר הקלת"ש
    first_wed = start + timedelta(days=(3 - dow(start)) % 7)
    for w in days(first_wed, end):
        if dow(w) != 3:
            continue
        nxt = w + timedelta(days=7)
        for _ in range(3):
            add("חובה", w, nxt, "שמירות חובה", "כלל הדרגות", GUARD, GUARD_NOTES)
        add("חובה", w, nxt, "רס\"ר", "כלל הדרגות", RASAR, RASAR_NOTES)
        add("חובה", w, nxt, "רסר הקלת\"ש", "ת\"ש 7", RASAR, RASAR_NOTES)

    # Sunday → Thursday: the logistics-centre רס"ר, every other week
    for i, s in enumerate(d for d in days(start, end) if dow(d) == 0):
        if i % 2 == 0:
            add("חובה", s, s + timedelta(days=4), "רס\"ר", "כלל הדרגות",
                "תורנות מרלו\"ג , יש להקצות בנים בלבד\nהעבודה בימים ראשון - חמישי בין השעות 08:00-17:00 בכל יום",
                "עומר סגל 050-0000004", "row")

    # Sunday → Sunday: soldier tasks, alternating sites
    for i, s in enumerate(d for d in days(start, end) if dow(d) == 0):
        add("משימות חיליות", s, s + timedelta(days=7), "אמ\"ת גבעת המורה" if i % 2 == 0 else "אמ\"ת חרבית", "סגן- סרן", EQUIP, "")
        if i % 4 == 1:
            add("משימות חיליות", s + timedelta(days=2), s + timedelta(days=2), "שיפוט צד", "רס\"ן", EQUIP, "")

    # Single days
    weekdays = [d for d in days(start, end) if dow(d) <= 4]
    for wk in range(0, len(weekdays), 5):
        week = weekdays[wk:wk + 5]
        for d in rnd.sample(week, min(2, len(week))):  # 2 קצין תורן days a week
            add("קצינים ונגדים", d, d, "קצין תורן", KTR, KT, "")
        d = rnd.choice(week)  # ממלכת יום once a week
        add("קצינים ונגדים", d, d, "ממלכת יום",
            "מבצעים אמהות/אבות במשרת הורה, אנשי קבע שעברו ועדת המרות, אנשי קבע בעלי פטור רפואי - כלל הדרגות",
            "ביצוע תדריך טלפוני מול מ\"ג תזונה בשעה 11:00", "איש קשר - מאיה רון 050-0000005")
        if (wk // 5) % 2 == 0:  # מפקד תורן every other week
            d = rnd.choice(week)
            add("קצינים ונגדים", d, d, "מפקד תורן", "רס\"ן, סרן במינוי רס\"ן",
                "זמני התורנות:\nיום א'/ חזרה מחג והדממה - 6 בבוקר עד 8 בבוקר למחרת\nימים ב' - ד' - 08:00-08:00\nיום ה' - 08:00-18:00", "", "names")

    # Shabbat קצין תורן (Friday → Saturday) every third weekend
    for i, f in enumerate(d for d in days(start, end) if dow(d) == 5):
        if i % 3 == 0:
            add("קצינים ונגדים", f, f + timedelta(days=1), "קצין תורן", KTR, KT, "")

    # 3-day gate duties, alternating south/north, every other week
    for i, s in enumerate(d for d in days(start, end) if dow(d) == 0):
        if i % 2 == 1:
            if (i // 2) % 2 == 0:
                add("קצינים ונגדים", s, s + timedelta(days=2), "ש.ג דרום 7-11", OFF, GATE, GATE_NOTES_S)
            else:
                add("קצינים ונגדים", s + timedelta(days=2), s + timedelta(days=4), "צפון 10-13,16-16", OFF, GATE, GATE_NOTES_N)

    # A ceremony once a month (3 soldiers, two days)
    m = date(start.year, start.month, 1)
    while m <= end:
        d = m + timedelta(days=21)
        while dow(d) not in (1, 2):
            d += timedelta(days=1)
        for k in range(3):
            day = d if k == 0 else d + timedelta(days=1)
            add("חובה", day, day, "רסר טקס רלצד", "", "", "", "row")
        m = date(m.year + (m.month == 12), m.month % 12 + 1, 1)

    rows.sort(key=lambda r: (r[1], r[2], r[4]))
    return rows


if __name__ == "__main__":
    a = date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else date(2027, 1, 1)
    b = date.fromisoformat(sys.argv[2]) if len(sys.argv) > 2 else date(2027, 6, 30)
    out = sys.argv[3] if len(sys.argv) > 3 else "base-cycle.xlsx"
    rows = build_rows(a, b)
    write(out, [
        (pop, datetime.combine(s, datetime.min.time()), datetime.combine(e, datetime.min.time()), "" if hol else "X",
         duty, "", "", "", "", ranks, instr, notes, hl)
        for pop, s, e, hol, duty, ranks, instr, notes, hl in rows
    ])
    print(f"{len(rows)} rows → {out}")
