"""A fictitious base schedule for a whole cycle with every duty type of the catalog.

Like make_base_cycle.py (same layout, rhythm and texts), but each row uses the catalog's
own duty name, so the file maps with no aliases, and every type has rows:
ממלכת יום, מפקד שער, מפקד תורן, אמ"ת, הגנ"ש, קצין הגנ"ק, קצין תורן (חול ושבת), רס"ר,
רס"ר הקלת ת"ש, מטבח, הכשרת מטבח לפסח ושמירות חובה. The "חג" column is empty on rows
that touch a holiday or holiday eve (rest days only) and X elsewhere.

    python tools/make_base_cycle_all.py 2027-07-01 2027-12-31 out.xlsx
"""

import random
import sys
from datetime import date, datetime, timedelta

from make_test_base import EQUIP, GATE, GATE_NOTES_N, GATE_NOTES_S, GUARD, GUARD_NOTES, KT, KTR, OFF, RASAR, RASAR_NOTES, write

# Rest holidays and their eves, Israel, as the app's calendar has them (Jul 2027 – Jun 2028).
HOLIDAYS = {
    date(2027, 10, 1), date(2027, 10, 2), date(2027, 10, 3),  # ראש השנה
    date(2027, 10, 10), date(2027, 10, 11),  # יום כיפור
    *(date(2027, 10, d) for d in range(15, 24)),  # סוכות עד שמחת תורה
}


def dow(d: date) -> int:
    """0 = Sunday … 6 = Saturday."""
    return d.isoweekday() % 7


def days(a: date, b: date):
    d = a
    while d <= b:
        yield d
        d += timedelta(days=1)


def build_rows(start: date, end: date, seed: int = 2027):
    rnd = random.Random(seed)
    rows = []

    def add(pop, a, b, duty, ranks, instr, notes, hl=None):
        if a < start or a > end:
            return  # a slot belongs to the cycle it starts in
        holiday = any(d in HOLIDAYS for d in days(a, b))
        rows.append((pop, a, b, holiday, duty, ranks, instr, notes, hl))

    sundays = [d for d in days(start, end) if dow(d) == 0]

    # Wednesday → Wednesday: 3 guard rows, רס"ר, רס"ר הקלת ת"ש
    for w in (d for d in days(start, end) if dow(d) == 3):
        nxt = w + timedelta(days=7)
        for _ in range(3):
            add("חובה", w, nxt, "שמירות חובה", "כלל הדרגות", GUARD, GUARD_NOTES)
        add("חובה", w, nxt, 'רס"ר', "כלל הדרגות", RASAR, RASAR_NOTES)
        add("חובה", w, nxt, 'רס"ר הקלת ת"ש', 'ת"ש 7', RASAR, RASAR_NOTES)

    # Sunday → Thursday: the logistics-centre רס"ר, every other week
    for i, s in enumerate(sundays):
        if i % 2 == 0:
            add("חובה", s, s + timedelta(days=4), 'רס"ר', "כלל הדרגות",
                'תורנות מרלו"ג , יש להקצות בנים בלבד\nהעבודה בימים ראשון - חמישי בין השעות 08:00-17:00 בכל יום',
                "עומר סגל 050-0000004", "row")

    # מטבח (שח"ר only): Sunday and Tuesday every week
    for s in sundays:
        for k in (0, 2):
            add("חובה", s + timedelta(days=k), s + timedelta(days=k), "מטבח", "",
                "התייצבות בשעה 07:30 במטבח הבסיס. נעליים סגורות ומדי ב'", "אב המטבח - רון דהן 050-0000006")

    # הכשרת מטבח לפסח: there is no Pesach in a Jul–Dec cycle; a short drill at the end so the
    # type has rows to schedule.
    last_sun = sundays[-1] - timedelta(days=7) if len(sundays) > 1 else sundays[-1]
    for k in range(3):
        d = last_sun + timedelta(days=k)
        add("חובה", d, d, "הכשרת מטבח לפסח", "כלל הדרגות", "תרגול הכשרת מטבח – התייצבות 08:00 במטבח הבסיס", "", "row")

    # Sunday → Sunday: אמ"ת every week; הגנ"ש every other week
    for i, s in enumerate(sundays):
        add("משימות חיליות", s, s + timedelta(days=7), 'אמ"ת', "סגן- סרן", EQUIP, "גבעת המורה" if i % 2 == 0 else "חרבית")
        if i % 2 == 1:
            add("משימות חיליות", s, s + timedelta(days=7), 'הגנ"ש', "", EQUIP, "")

    # Single weekdays
    weekdays = [d for d in days(start, end) if dow(d) <= 4]
    for wk in range(0, len(weekdays), 5):
        week = weekdays[wk:wk + 5]
        for d in rnd.sample(week, min(2, len(week))):  # 2 קצין תורן days a week
            add("קצינים ונגדים", d, d, "קצין תורן", KTR, KT, "")
        for d in rnd.sample(week, min(2, len(week))):  # 2 קצין הגנ"ק days a week
            add("קצינים ונגדים", d, d, 'קצין הגנ"ק', "", GUARD, GUARD_NOTES)
        d = rnd.choice(week)  # ממלכת יום once a week
        add("קצינים ונגדים", d, d, "ממלכת יום",
            "מבצעים אמהות/אבות במשרת הורה, אנשי קבע שעברו ועדת המרות, אנשי קבע בעלי פטור רפואי - כלל הדרגות",
            'ביצוע תדריך טלפוני מול מ"ג תזונה בשעה 11:00', "איש קשר - מאיה רון 050-0000005")
        if (wk // 5) % 2 == 0:  # מפקד תורן every other week
            d = rnd.choice(week)
            add("קצינים ונגדים", d, d, "מפקד תורן", 'רס"ן, סרן במינוי רס"ן',
                "זמני התורנות:\nיום א'/ חזרה מחג והדממה - 6 בבוקר עד 8 בבוקר למחרת\nימים ב' - ד' - 08:00-08:00\nיום ה' - 08:00-18:00", "", "names")

    # Shabbat קצין תורן (Friday → Saturday) every third weekend, and every holiday eve
    for i, f in enumerate(d for d in days(start, end) if dow(d) == 5):
        if i % 3 == 0:
            add("קצינים ונגדים", f, f + timedelta(days=1), "קצין תורן", KTR, KT, "")
    for d in sorted(HOLIDAYS):
        if d - timedelta(days=1) not in HOLIDAYS and dow(d) not in (5, 6):
            add("קצינים ונגדים", d, d + timedelta(days=1), "קצין תורן", KTR, KT, "ערב חג")

    # 3-day gate duties, alternating south/north, every other week
    for i, s in enumerate(sundays):
        if i % 2 == 1:
            if (i // 2) % 2 == 0:
                add("קצינים ונגדים", s, s + timedelta(days=2), "מפקד שער", OFF, GATE, GATE_NOTES_S)
            else:
                add("קצינים ונגדים", s + timedelta(days=2), s + timedelta(days=4), "מפקד שער", OFF, GATE, GATE_NOTES_N)

    rows.sort(key=lambda r: (r[1], r[2], r[4]))
    return rows


if __name__ == "__main__":
    a = date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else date(2027, 7, 1)
    b = date.fromisoformat(sys.argv[2]) if len(sys.argv) > 2 else date(2027, 12, 31)
    out = sys.argv[3] if len(sys.argv) > 3 else "base-cycle.xlsx"
    rows = build_rows(a, b)
    write(out, [
        (pop, datetime.combine(s, datetime.min.time()), datetime.combine(e, datetime.min.time()), "" if hol else "X",
         duty, "", "", "", "", ranks, instr, notes, hl)
        for pop, s, e, hol, duty, ranks, instr, notes, hl in rows
    ])
    from collections import Counter
    print(f"{len(rows)} rows → {out}")
    for k, v in sorted(Counter(r[4] for r in rows).items()):
        print(f"  {k}: {v}")
