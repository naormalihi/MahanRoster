"""Duty scoring: day units, multipliers and load-factor normalization.

P = W_task × M per day unit.

* A duty is split into 24-hour units from its start; a remainder shorter than
  24 hours is one more unit. Each unit is scored by the day it starts on.
* Normalized points = P / F, where F is the soldier's load factor on the day
  each unit starts.

With user-defined multipliers (settings.multipliers, from the database), M is
the highest multiplier whose conditions all hold for the unit, at least 1:
the unit's day has one of the calendar day types / is one of the weekdays /
is in the date range; the duty is shorter than 24 hours and most of its hours
fall in the time window. One marked skip_shabbat_types is not applied to
Shabbat task types.

Without them (older inputs), the fixed three apply, M = M_day × M_night:
* Weekend = a unit starting on Friday or Saturday. Holiday = a unit starting
  on a holiday or holiday eve. When both apply, the higher multiplier is used.
* The weekend multiplier is not applied to Shabbat task types (they have
  their own weight). The holiday multiplier is.
* The night multiplier applies only to duties shorter than 24 hours whose
  hours fall mostly in the night window.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Iterable

from .models import Multiplier, Settings, Soldier, TaskType

DAY = timedelta(hours=24)


def parse_window(window: str) -> tuple[time, time]:
    start, end = window.split("-")
    return time.fromisoformat(start.strip()), time.fromisoformat(end.strip())


def day_units(starts_at: datetime, ends_at: datetime) -> list[datetime]:
    """Start time of every 24-hour unit of a duty."""
    if ends_at <= starts_at:
        raise ValueError(f"duty ends before it starts: {starts_at} – {ends_at}")
    units = []
    t = starts_at
    while t < ends_at:
        units.append(t)
        t += DAY
    return units


def window_intervals(window: str, start: datetime, end: datetime) -> Iterable[tuple[datetime, datetime]]:
    """Concrete datetime intervals of a daily window that may touch [start, end)."""
    w_start, w_end = parse_window(window)
    day = start.date() - timedelta(days=1)
    while day <= end.date():
        a = datetime.combine(day, w_start)
        b = datetime.combine(day, w_end)
        if b <= a:  # window crosses midnight
            b += DAY
        yield a, b
        day += timedelta(days=1)


def overlap_minutes(a0: datetime, a1: datetime, b0: datetime, b1: datetime) -> float:
    lo, hi = max(a0, b0), min(a1, b1)
    return max(0.0, (hi - lo).total_seconds() / 60.0)


def window_overlap_minutes(window: str, start: datetime, end: datetime) -> float:
    return sum(overlap_minutes(start, end, a, b) for a, b in window_intervals(window, start, end))


def is_night_duty(starts_at: datetime, ends_at: datetime, settings: Settings) -> bool:
    duration = (ends_at - starts_at).total_seconds() / 60.0
    if duration >= 24 * 60:
        return False
    return window_overlap_minutes(settings.night_window, starts_at, ends_at) > duration / 2


def is_weekend_day(day: date, settings: Settings) -> bool:
    return day.weekday() in settings.weekend_weekdays


def unit_day_multiplier(day: date, task: TaskType, settings: Settings, holidays: set[date]) -> float:
    m = 1.0
    if day in holidays:
        m = max(m, settings.holiday_multiplier)
    if is_weekend_day(day, settings) and not task.is_weekend_type:
        m = max(m, settings.weekend_multiplier)
    return m


def multiplier_applies(
    m: Multiplier, day: date, task: TaskType, starts_at: datetime, ends_at: datetime, settings: Settings
) -> bool:
    if m.skip_shabbat_types and task.is_weekend_type:
        return False
    if m.day_types and settings.day_types.get(day.isoformat()) not in m.day_types:
        return False
    if m.holidays or m.holiday_kinds:
        hk = settings.day_holidays.get(day.isoformat())
        if not hk or (m.holidays and hk[0] not in m.holidays) or (m.holiday_kinds and hk[1] not in m.holiday_kinds):
            return False
    if m.weekdays and day.weekday() not in m.weekdays:
        return False
    if m.date_from and day < m.date_from or m.date_to and day > m.date_to:
        return False
    if m.time_window:
        duration = (ends_at - starts_at).total_seconds() / 60.0
        if duration >= 24 * 60 or window_overlap_minutes(m.time_window, starts_at, ends_at) <= duration / 2:
            return False
    return True


def unit_points(
    task: TaskType, starts_at: datetime, ends_at: datetime, settings: Settings, holidays: set[date]
) -> list[tuple[date, float]]:
    """(day, raw points) for every day unit of a duty."""
    if settings.multipliers is not None:
        return [
            (
                u.date(),
                task.weight
                * max(
                    [1.0]
                    + [m.value for m in settings.multipliers if multiplier_applies(m, u.date(), task, starts_at, ends_at, settings)]
                ),
            )
            for u in day_units(starts_at, ends_at)
        ]
    night = settings.night_multiplier if is_night_duty(starts_at, ends_at, settings) else 1.0
    return [
        (u.date(), task.weight * unit_day_multiplier(u.date(), task, settings, holidays) * night)
        for u in day_units(starts_at, ends_at)
    ]


def raw_points(task: TaskType, starts_at: datetime, ends_at: datetime, settings: Settings, holidays: set[date]) -> float:
    return sum(p for _, p in unit_points(task, starts_at, ends_at, settings, holidays))


def normalized_points(
    soldier: Soldier, task: TaskType, starts_at: datetime, ends_at: datetime, settings: Settings, holidays: set[date]
) -> float:
    return sum(p / soldier.factor_on(d) for d, p in unit_points(task, starts_at, ends_at, settings, holidays))


def weekend_units(starts_at: datetime, ends_at: datetime, settings: Settings, holidays: set[date]) -> int:
    """Number of units that start on a weekend day or a holiday (for weekend balancing)."""
    return sum(
        1 for u in day_units(starts_at, ends_at) if is_weekend_day(u.date(), settings) or u.date() in holidays
    )
