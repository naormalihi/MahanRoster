from datetime import date, datetime

from toranut_solver.models import Problem, Settings, Slot, Soldier, TaskType

GUARD = TaskType("guard", "שמירה", 1.0, min_rest_hours=12, service_restriction="mandatory", requires_weapon=True)
SHABBAT = TaskType("guard_shabbat", "שמירה – שבת", 2.5, min_rest_hours=24, is_weekend_type=True)
NIGHT = TaskType("towers", "מגדלים", 1.0, min_rest_hours=12)
DAYDUTY = TaskType("day", "ממלכ\"ת יום", 0.6, qualifying_duty=True, shachar_compatible=True)


def dt(s: str) -> datetime:
    return datetime.fromisoformat(s)


def soldier(sid: str, gaf: str = "G1", **kw) -> Soldier:
    base = dict(
        service_type="mandatory",
        rank_order=2,
        populations=["mandatory"],
        gender="male",
        range_valid_until=date(2030, 1, 1),
        balance_population="mandatory",
    )
    base.update(kw)
    return Soldier(sid, gaf, **base)


def slot(sid: str, task: str, start: str, end: str, p: int = 1, r: int = 1, **kw) -> Slot:
    return Slot(sid, task, dt(start), dt(end), p, r, **kw)


def problem(soldiers, slots, tasks=(GUARD, SHABBAT, NIGHT, DAYDUTY), **kw) -> Problem:
    return Problem(
        cycle_id="t",
        cycle_start=date(2027, 1, 3),
        cycle_end=date(2027, 1, 31),
        task_types=list(tasks),
        soldiers=list(soldiers),
        slots=list(slots),
        settings=kw.pop("settings", Settings()),
        **kw,
    )
