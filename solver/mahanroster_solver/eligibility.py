"""Hard eligibility of a soldier for a slot.

`check(soldier, slot)` returns the list of reasons the soldier cannot be
assigned to the slot; an empty list means eligible. Reasons are stable codes
so that the UI can translate them and the "why unfilled" report can count them.

Rest between duties and overlap with other duties depend on the whole
schedule and are enforced by the solver, not here.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta

from typing import Optional

from .models import SERVICE_MANDATORY, Problem, Settings, Slot, Soldier, TaskType
from .scoring import overlap_minutes, parse_window, window_intervals, window_overlap_minutes

REASON_LABELS = {
    "service": "המשימה מוגבלת לחובה או לקבע",
    "population": "אוכלוסייה לא זכאית",
    "rank": "דרגה מחוץ לטווח",
    "gender": "מגדר",
    "qualifying_only": "משרת הורה או פטור מזכה – רק ממלכ\"ת יום",
    "not_qualifying": "ממלכ\"ת יום – רק למשרתי הורה, בעלי פטור מזכה והאוכלוסיות שהוגדרו לה",
    "shachar": "שח\"ר – המשימה לא מסומנת מתאימה לשח\"ר",
    "shachar_only": "המשימה רק לשח\"ר",
    "home_nightly": "ת\"ש 7 – לא לן בבסיס, והתורנות כוללת שעות לילה",
    "tash_closed": "התורנות לא מתאימה לבעלי הת\"ש",
    "tash_nights": "הת\"ש – יותר לילות בבסיס בשבוע ממה שמותר לו",
    "weapon_range": "מטווח לא בתוקף ביום התורנות",
    "not_enlisted": "לפני תאריך הגיוס",
    "released": "אחרי תאריך השחרור",
    "grace": "חדש ביחידה (תקופת חסד)",
    "exemption": "פטור מאושר",
    "absence": "היעדרות",
    "date_block": "חסימת תאריך",
    "personal_constraint": "אילוץ אישי",
    "penalty_other": "משבצת קנס של עובד אחר",
    "busy": "משובץ בתורנות סמוכה (כולל מנוחה)",
    "removed": "הוסר מהתורנות הזו",
}


def _days(start: datetime, end: datetime) -> list[date]:
    """Calendar days a duty touches (an end exactly at midnight does not touch the next day)."""
    last = (end - timedelta(microseconds=1)).date()
    d, out = start.date(), []
    while d <= last:
        out.append(d)
        d += timedelta(days=1)
    return out


def _worked(slot: Slot) -> list[tuple[datetime, datetime]]:
    """The hours a slot is actually worked: the whole span, or its daily hours on each day."""
    if not slot.daily_hours:
        return [(slot.starts_at, slot.ends_at)]
    t0, t1 = parse_window(slot.daily_hours)
    out = []
    for d in _days(slot.starts_at, slot.ends_at):
        a = datetime.combine(d, t0)
        b = datetime.combine(d + timedelta(days=1) if t1 <= t0 else d, t1)
        a, b = max(a, slot.starts_at), min(b, slot.ends_at)
        if a < b:
            out.append((a, b))
    return out


TASH_HOME, TASH_CLOSED = "home", "closed"


def week_of(d: date) -> date:
    """The Sunday that opens the week of a day."""
    return d - timedelta(days=(d.weekday() + 1) % 7)


def base_nights(slot: Slot, task: TaskType, settings: Settings) -> list[date]:
    """Nights (by their evening's date) the slot keeps its performer on base: the night window
    overlaps the hours worked. A duty marked fit for הת"ש keeps no one on base."""
    if task.tash_rule == TASH_HOME:
        return []
    worked = _worked(slot)
    return [
        a.date()
        for a, b in window_intervals(settings.night_window, slot.starts_at, slot.ends_at)
        if any(overlap_minutes(a, b, x, y) > 0 for x, y in worked)
    ]


def is_holiday_slot(slot: Slot, holidays: set[date]) -> bool:
    """A duty on a holiday or its eve (any of the days it touches)."""
    return any(d in holidays for d in _days(slot.starts_at, slot.ends_at))


def nights_by_week(nights: list[date]) -> dict[date, int]:
    out: dict[date, int] = defaultdict(int)
    for n in nights:
        out[week_of(n)] += 1
    return dict(out)


def max_base_nights(soldier: Soldier) -> Optional[int]:
    """Nights on base allowed a week: 0 for ת"ש 7, 7 − level for הת"ש 3–6, None = no limit."""
    if soldier.home_nightly or soldier.tash_level == 7:
        return 0
    return 7 - soldier.tash_level if soldier.tash_level else None


def _window_overlap(window: str, slot: Slot) -> float:
    return sum(window_overlap_minutes(window, a, b) for a, b in _worked(slot))


def _overlaps(a0: datetime, a1: datetime, b0: datetime, b1: datetime) -> bool:
    return a0 < b1 and b0 < a1


class EligibilityIndex:
    """Pre-indexes per-soldier records so each check is cheap."""

    def __init__(self, problem: Problem):
        self.problem = problem
        self.tasks: dict[str, TaskType] = {t.id: t for t in problem.task_types}
        self.exemptions = defaultdict(list)
        for e in problem.exemptions:
            self.exemptions[e.soldier_id].append(e)
        self.absences = defaultdict(list)
        for a in problem.absences:
            self.absences[a.soldier_id].append(a)
        self.busy = defaultdict(list)
        for a in problem.busy:
            self.busy[a.soldier_id].append(a)
        self.blocks = defaultdict(set)
        for b in problem.date_blocks:
            self.blocks[b.soldier_id].add(b.date)
        self.excluded = {(x.slot_id, x.soldier_id) for x in problem.excluded}
        self.personal = defaultdict(list)
        for c in problem.personal_constraints:
            self.personal[c.soldier_id].append(c)

    def priority(self, soldier: Soldier, slot: Slot) -> bool:
        """A qualifying duty (ממלכ"ת יום) goes first to a parent, a holder of a qualifying exemption,
        one of the populations listed on the type (e.g. רס"ן), or one whose exemption in force
        permits this duty. Any other duty: everyone alike."""
        task = self.tasks[slot.task_type_id]
        if not task.qualifying_duty:
            return True
        first_day, last_day = slot.starts_at.date(), (slot.ends_at - timedelta(microseconds=1)).date()
        listed = bool(task.eligible_populations) and bool(set(task.eligible_populations) & set(soldier.populations))
        by_exemption = any(
            task.id in e.qualifies_task_type_ids and e.start_date <= first_day and e.end_date >= last_day
            for e in self.exemptions.get(soldier.id, ())
        )
        return soldier.qualifies_day_only or listed or by_exemption

    def check(self, soldier: Soldier, slot: Slot) -> list[str]:
        task = self.tasks[slot.task_type_id]
        settings = self.problem.settings
        reasons: list[str] = []
        first_day, last_day = slot.starts_at.date(), (slot.ends_at - timedelta(microseconds=1)).date()

        if slot.is_penalty:
            # A penalty slot belongs to the soldier the base named; it is not a pool slot.
            return [] if slot.penalty_soldier_id == soldier.id else ["penalty_other"]

        # --- who the duty is for -------------------------------------------------
        if task.service_restriction != "any" and soldier.service_type != task.service_restriction:
            reasons.append("service")
        if task.qualifying_duty:
            # Open to everyone (decided 24.11): parents, qualifying-exemption holders and the populations
            # listed on the type come first – see priority(); the others only when none of them can.
            pass
        else:
            if soldier.qualifies_day_only:
                reasons.append("qualifying_only")
            if task.eligible_populations and not set(task.eligible_populations) & set(soldier.populations):
                reasons.append("population")
        if slot.allowed_ranks is not None:
            if soldier.rank_order not in slot.allowed_ranks:
                reasons.append("rank")
        elif task.allowed_ranks is not None:
            if soldier.rank_order not in task.allowed_ranks:
                reasons.append("rank")
        else:
            rank_min = slot.rank_min if slot.rank_min is not None else task.rank_min
            rank_max = slot.rank_max if slot.rank_max is not None else task.rank_max
            if (rank_min is not None and soldier.rank_order < rank_min) or (
                rank_max is not None and soldier.rank_order > rank_max
            ):
                reasons.append("rank")
        gender = slot.gender or task.gender
        if gender and soldier.gender != gender:
            reasons.append("gender")
        if soldier.is_shachar and soldier.service_type == SERVICE_MANDATORY and not task.shachar_compatible:
            reasons.append("shachar")
        if task.shachar_only and not (soldier.is_shachar and soldier.service_type == SERVICE_MANDATORY):
            reasons.append("shachar_only")
        has_tash = soldier.home_nightly or soldier.tash_level is not None
        if task.tash_rule == TASH_CLOSED and has_tash:
            reasons.append("tash_closed")
        limit = max_base_nights(soldier)
        if limit == 0 and task.tash_rule != TASH_HOME and _window_overlap(settings.night_window, slot) > 0:
            reasons.append("home_nightly")
        elif limit and any(n > limit for n in nights_by_week(base_nights(slot, task, settings)).values()):
            reasons.append("tash_nights")

        # --- dates of service ----------------------------------------------------
        if task.requires_weapon and (soldier.range_valid_until is None or soldier.range_valid_until < last_day):
            reasons.append("weapon_range")
        if soldier.enlistment_date and first_day < soldier.enlistment_date:
            reasons.append("not_enlisted")
        if soldier.release_date and last_day > soldier.release_date:
            reasons.append("released")
        if soldier.unit_join_date and first_day < soldier.unit_join_date + timedelta(days=settings.grace_days):
            reasons.append("grace")

        # --- personal records ----------------------------------------------------
        for e in self.exemptions.get(soldier.id, ()):
            if e.end_date < first_day or e.start_date > last_day:
                continue
            if e.excluded_task_type_ids is None and e.restricted_hours is None:
                reasons.append("exemption")
                break
            by_type = e.excluded_task_type_ids is None or task.id in e.excluded_task_type_ids
            by_hours = e.restricted_hours is None or _window_overlap(e.restricted_hours, slot) > 0
            if by_type and by_hours:
                reasons.append("exemption")
                break
        from_ = min(slot.briefing_at, slot.starts_at) if slot.briefing_at else slot.starts_at
        if any(_overlaps(from_, slot.ends_at, a.starts_at, a.ends_at) for a in self.absences.get(soldier.id, ())):
            reasons.append("absence")
        if any(_overlaps(slot.starts_at, slot.ends_at, a.starts_at, a.ends_at) for a in self.busy.get(soldier.id, ())):
            reasons.append("busy")
        if (slot.id, soldier.id) in self.excluded:
            reasons.append("removed")
        if self.blocks.get(soldier.id) and any(d in self.blocks[soldier.id] for d in _days(from_, slot.ends_at)):
            reasons.append("date_block")
        for c in self.personal.get(soldier.id, ()):
            if c.valid_until and c.valid_until < first_day:
                continue
            if c.task_type_id and c.task_type_id != task.id:
                continue
            if c.time_window is None or _window_overlap(c.time_window, slot) > 0:
                reasons.append("personal_constraint")
                break
        return reasons


def label(reason: str) -> str:
    return REASON_LABELS.get(reason, reason)
