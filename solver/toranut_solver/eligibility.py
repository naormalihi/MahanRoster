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

from .models import SERVICE_MANDATORY, Problem, Slot, Soldier, TaskType
from .scoring import window_overlap_minutes

REASON_LABELS = {
    "service": "המשימה מוגבלת לחובה או לקבע",
    "population": "אוכלוסייה לא זכאית",
    "rank": "דרגה מחוץ לטווח",
    "gender": "מגדר",
    "qualifying_only": "משרת הורה או פטור מזכה – רק ממלכ\"ת יום",
    "not_qualifying": "ממלכ\"ת יום – רק למשרתי הורה ובעלי פטור מזכה",
    "shachar": "שח\"ר – המשימה לא מסומנת מתאימה לשח\"ר",
    "weapon_range": "מטווח לא בתוקף ביום התורנות",
    "not_enlisted": "לפני תאריך הגיוס",
    "released": "אחרי תאריך השחרור",
    "grace": "חודש חסד",
    "exemption": "פטור מאושר",
    "absence": "היעדרות",
    "date_block": "חסימת תאריך",
    "personal_constraint": "אילוץ אישי",
    "penalty_other": "משבצת קנס של חייל אחר",
}


def _days(start: datetime, end: datetime) -> list[date]:
    """Calendar days a duty touches (an end exactly at midnight does not touch the next day)."""
    last = (end - timedelta(microseconds=1)).date()
    d, out = start.date(), []
    while d <= last:
        out.append(d)
        d += timedelta(days=1)
    return out


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
        self.blocks = defaultdict(set)
        for b in problem.date_blocks:
            self.blocks[b.soldier_id].add(b.date)
        self.personal = defaultdict(list)
        for c in problem.personal_constraints:
            self.personal[c.soldier_id].append(c)

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
            if not soldier.qualifies_day_only:
                reasons.append("not_qualifying")
        else:
            if soldier.qualifies_day_only:
                reasons.append("qualifying_only")
            if task.eligible_populations and not set(task.eligible_populations) & set(soldier.populations):
                reasons.append("population")
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
            by_hours = e.restricted_hours is None or window_overlap_minutes(
                e.restricted_hours, slot.starts_at, slot.ends_at
            ) > 0
            if by_type and by_hours:
                reasons.append("exemption")
                break
        if any(_overlaps(slot.starts_at, slot.ends_at, a.starts_at, a.ends_at) for a in self.absences.get(soldier.id, ())):
            reasons.append("absence")
        if self.blocks.get(soldier.id) and any(d in self.blocks[soldier.id] for d in _days(slot.starts_at, slot.ends_at)):
            reasons.append("date_block")
        for c in self.personal.get(soldier.id, ()):
            if c.valid_until and c.valid_until < first_day:
                continue
            if c.task_type_id and c.task_type_id != task.id:
                continue
            if c.time_window is None or window_overlap_minutes(c.time_window, slot.starts_at, slot.ends_at) > 0:
                reasons.append("personal_constraint")
                break
        return reasons


def label(reason: str) -> str:
    return REASON_LABELS.get(reason, reason)
