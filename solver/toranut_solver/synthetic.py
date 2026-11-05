"""Generator of an anonymized, fictitious unit for development and benchmarks.

No real names or numbers: soldiers are S0001…, gafim G1…. The duty catalog
follows the spec's starting catalog; weights and hours are examples only.
"""

from __future__ import annotations

import random
from datetime import date, datetime, time, timedelta

from .models import (
    SERVICE_CAREER,
    SERVICE_MANDATORY,
    Absence,
    DateBlock,
    Exemption,
    LoadRolePeriod,
    PersonalConstraint,
    Problem,
    Settings,
    Slot,
    Soldier,
    TaskType,
)

# Rank sort_order – mandatory 1-4, NCO career 5-9, officers 10+.
RANKS = {
    "טוראי": 1, "רב\"ט": 2, "סמל": 3, "סמ\"ר": 4,
    "רס\"ל": 5, "רס\"ר": 6, "רס\"מ": 7, "רס\"ב": 8, "רנ\"ג": 9,
    "סגן": 10, "סרן": 11, "רס\"ן": 12, "סא\"ל": 13,
}
OFFICER_MIN = RANKS["סגן"]
MAJOR = RANKS["רס\"ן"]

TASK_TYPES = [
    TaskType("hagnash", "הגנ\"ש", 1.0, 24, "any", True, eligible_populations=["career", "officer"], rank_max=RANKS["סרן"]),
    TaskType("katzin_toran", "קצין תורן – חול", 1.0, 24, "any", False, eligible_populations=["officer"]),
    TaskType("katzin_toran_shabbat", "קצין תורן – שבת", 2.5, 24, "any", False, is_weekend_type=True, eligible_populations=["officer"]),
    TaskType("mefaked_shaar", "מפקד שער – חול", 1.0, 24, "any", True, eligible_populations=["career", "officer"]),
    TaskType("mefaked_shaar_shabbat", "מפקד שער – שבת", 2.5, 24, "any", True, is_weekend_type=True, eligible_populations=["career", "officer"]),
    TaskType("mamlachat_layla", "ממלכ\"ת לילה", 1.0, 12, "any", False, eligible_populations=["major"]),
    TaskType("mamlachat_yom", "ממלכ\"ת יום", 0.6, 0, "any", False, shachar_compatible=True, qualifying_duty=True),
    TaskType("shag", "ש\"ג – חול", 1.0, 24, SERVICE_MANDATORY, True, eligible_populations=["mandatory"]),
    TaskType("shag_shabbat", "ש\"ג – שבת", 2.5, 24, SERVICE_MANDATORY, True, is_weekend_type=True, eligible_populations=["mandatory"]),
    TaskType("migdalim", "מגדלים – חול", 1.0, 12, SERVICE_MANDATORY, True, eligible_populations=["mandatory"]),
    TaskType("mitbach_shabbat", "מטבח – שבת", 2.0, 24, SERVICE_MANDATORY, False, is_weekend_type=True, eligible_populations=["mandatory"]),
    TaskType("rasar", "רס\"ר – חול", 0.8, 12, SERVICE_MANDATORY, False, shachar_compatible=True, eligible_populations=["mandatory"]),
]


def _at(d: date, hh: int, mm: int = 0) -> datetime:
    return datetime.combine(d, time(hh, mm))


def generate_slots(start: date, end: date) -> list[Slot]:
    slots: list[Slot] = []

    def add(task: str, s: datetime, e: datetime, performers: int = 1, reserves: int = 1):
        slots.append(Slot(f"{task}-{s:%Y%m%d%H%M}", task, s, e, performers, reserves))

    d = start
    while d <= end:
        wd = d.weekday()  # Mon=0 … Fri=4, Sat=5, Sun=6
        nxt = d + timedelta(days=1)
        if wd in (6, 0, 1, 2, 3):  # Sunday–Thursday
            add("hagnash", _at(d, 8), _at(nxt, 8))
            add("katzin_toran", _at(d, 8), _at(nxt, 8))
            add("mefaked_shaar", _at(d, 8), _at(nxt, 8))
            add("mamlachat_layla", _at(d, 20), _at(nxt, 8))
            add("mamlachat_yom", _at(d, 8, 30), _at(d, 16, 30), reserves=0)
            add("shag", _at(d, 8), _at(nxt, 8), performers=2, reserves=2)
            add("migdalim", _at(d, 20), _at(nxt, 8), performers=2, reserves=2)
            add("rasar", _at(d, 8, 30), _at(d, 17, 30))
        if wd == 4:  # Friday 08:00 – Sunday 08:00, two day units
            sun = d + timedelta(days=2)
            add("hagnash", _at(d, 8), _at(sun, 8))
            add("katzin_toran_shabbat", _at(d, 8), _at(sun, 8))
            add("mefaked_shaar_shabbat", _at(d, 8), _at(sun, 8))
            add("shag_shabbat", _at(d, 8), _at(sun, 8), performers=2, reserves=2)
            add("mitbach_shabbat", _at(d, 12), _at(sun, 8), performers=2, reserves=1)
        d = nxt
    return slots


def generate(
    months: int = 1,
    soldiers: int = 240,
    gafim: int = 6,
    start: date = date(2027, 1, 3),
    seed: int = 1,
) -> Problem:
    rnd = random.Random(seed)
    end = start + timedelta(days=30 * months - 1)
    n_mand = int(soldiers * 0.62)
    people: list[Soldier] = []
    for i in range(soldiers):
        sid = f"S{i + 1:04d}"
        gaf = f"G{rnd.randint(1, gafim)}"
        gender = "male" if rnd.random() < 0.65 else "female"
        if i < n_mand:
            rank = rnd.choice([1, 2, 2, 3, 3, 4])
            s = Soldier(
                sid, gaf, SERVICE_MANDATORY, rank, ["mandatory"], gender,
                enlistment_date=start - timedelta(days=rnd.randint(60, 900)),
                release_date=start + timedelta(days=rnd.randint(20, 900)),
                range_valid_until=start + timedelta(days=rnd.randint(-30, 120) if rnd.random() < 0.1 else rnd.randint(200, 500)),
                is_shachar=rnd.random() < 0.05,
                balance_population=SERVICE_MANDATORY,
                baseline_score=round(rnd.gauss(14, 3), 1),
                baseline_weekends=rnd.randint(1, 5),
                baseline_reserves=rnd.randint(2, 8),
            )
        else:
            rank = rnd.choice([5, 6, 7, 8, 9, 10, 10, 11, 11, 11, 12, 12, 13])
            pops = ["career"] + (["officer"] if rank >= OFFICER_MIN else []) + (["major"] if rank >= MAJOR else [])
            s = Soldier(
                sid, gaf, SERVICE_CAREER, rank, pops, gender,
                enlistment_date=start - timedelta(days=rnd.randint(1000, 6000)),
                release_date=None,
                range_valid_until=start + timedelta(days=rnd.randint(-30, 120) if rnd.random() < 0.1 else rnd.randint(200, 500)),
                qualifies_day_only=rnd.random() < 0.08,
                balance_population=SERVICE_CAREER,
                baseline_score=round(rnd.gauss(10, 2.5), 1),
                baseline_weekends=rnd.randint(0, 4),
                baseline_reserves=rnd.randint(1, 6),
            )
        roll = rnd.random()
        if roll < 0.08:
            s.load_roles = [LoadRolePeriod(0.5, start - timedelta(days=200))]  # ראש צוות
        elif roll < 0.18:
            s.load_roles = [LoadRolePeriod(0.7, start - timedelta(days=200))]  # כונן
        if rnd.random() < 0.03:  # new to the unit – grace period
            s.unit_join_date = start - timedelta(days=rnd.randint(0, 25))
        people.append(s)

    exemptions, absences, blocks, personal = [], [], [], []
    for s in people:
        if rnd.random() < 0.05:
            a = start + timedelta(days=rnd.randint(0, 20))
            exemptions.append(Exemption(s.id, a, a + timedelta(days=rnd.randint(14, 60))))
        elif rnd.random() < 0.05:
            exemptions.append(
                Exemption(s.id, start, end, excluded_task_type_ids=[t.id for t in TASK_TYPES if t.requires_weapon])
            )
        if rnd.random() < 0.15:
            a = start + timedelta(days=rnd.randint(0, 25))
            absences.append(Absence(s.id, _at(a, 8), _at(a + timedelta(days=rnd.randint(2, 10)), 17)))
        m = 0
        while m < months:
            if rnd.random() < 0.5:
                blocks.append(DateBlock(s.id, start + timedelta(days=30 * m + rnd.randint(0, 29))))
            m += 1
        if rnd.random() < 0.02:
            personal.append(PersonalConstraint(s.id, "mefaked_shaar", "18:00-06:00"))

    return Problem(
        cycle_id=f"synthetic-{start:%Y%m}-{months}m",
        cycle_start=start,
        cycle_end=end,
        task_types=[TaskType(**t.__dict__) for t in TASK_TYPES],
        soldiers=people,
        slots=generate_slots(start, end),
        settings=Settings(random_seed=seed),
        holidays=[],
        exemptions=exemptions,
        absences=absences,
        date_blocks=blocks,
        personal_constraints=personal,
    )
