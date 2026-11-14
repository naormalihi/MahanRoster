"""Chronological greedy schedule.

Used as a starting point (hint) for CP-SAT, so the solver begins from a full,
valid schedule and only has to improve it. It obeys the same hard rules:
eligibility, rest windows for performers and reserves, mandatory reserve from
the performer's gaf, fixed assignments and the monthly cap.
"""

from __future__ import annotations

import bisect
from collections import defaultdict
from datetime import datetime, timedelta

from .eligibility import base_nights, is_holiday_slot, max_base_nights, nights_by_week
from .models import ROLE_PERFORMER, ROLE_RESERVE, SERVICE_MANDATORY, Problem

LOOKBACK = timedelta(days=14)  # longer than any duty plus its rest


def greedy(problem: Problem, prep) -> list[tuple[str, str, str]]:
    soldiers = {s.id: s for s in problem.soldiers}
    tasks = {t.id: t for t in problem.task_types}
    busy: dict[str, list[tuple[datetime, datetime]]] = defaultdict(list)  # sorted by start
    score = {s.id: s.baseline_score * 100 for s in problem.soldiers}
    reserves = {s.id: s.baseline_reserves for s in problem.soldiers}
    weekends = {s.id: s.baseline_weekends for s in problem.soldiers}
    month_count = defaultdict(int)
    cap = problem.settings.duty_cap_per_month
    nights = defaultdict(int)  # (soldier, week) -> nights on base so far, for הת"ש limits
    holidays = set(problem.holidays)
    had_holiday = {s.id: s.recent_holiday for s in problem.soldiers}  # a holiday duty: past year or here
    chosen: list[tuple[str, str, str]] = []
    fixed = defaultdict(list)
    for f in problem.fixed:
        fixed[f.slot_id].append(f)

    def free(sid: str, a: datetime, b: datetime) -> bool:
        lst = busy[sid]
        j = bisect.bisect_left(lst, (b, b)) - 1  # last entry starting before b
        while j >= 0:
            s, e = lst[j]
            if a < e:
                return False
            if s < a - LOOKBACK:  # no earlier entry can reach past a
                break
            j -= 1
        return True

    def take(sid: str, kid: str, role: str, a: datetime, b: datetime):
        bisect.insort(busy[sid], (a, b))
        chosen.append((sid, kid, role))
        if role == ROLE_PERFORMER and is_holiday_slot(slots_by_id[kid], holidays):
            had_holiday[sid] = True
        if role == ROLE_PERFORMER and max_base_nights(soldiers[sid]):
            for wk, n in week_nights[kid].items():
                nights[sid, wk] += n

    def nights_ok(sid: str, kid: str) -> bool:
        limit = max_base_nights(soldiers[sid])
        return not limit or all(nights[sid, wk] + n <= limit for wk, n in week_nights[kid].items())

    slots_by_id = {k.id: k for k in problem.slots}
    week_nights = {
        k.id: nights_by_week(base_nights(k, tasks[k.task_type_id], problem.settings)) for k in problem.slots
    }

    for k in sorted(problem.slots, key=lambda k: k.starts_at):
        a = k.starts_at
        b = k.ends_at + timedelta(hours=tasks[k.task_type_id].min_rest_hours)
        month = (k.starts_at.year, k.starts_at.month)
        elig = prep.eligible[k.id]
        performers: list[str] = []
        res_list: list[str] = []
        for f in fixed.get(k.id, ()):
            if f.soldier_id in soldiers:
                (performers if f.role == ROLE_PERFORMER else res_list).append(f.soldier_id)
                take(f.soldier_id, k.id, f.role, a, b)
        if k.is_penalty and k.penalty_soldier_id in elig and k.penalty_soldier_id not in performers:
            performers.append(k.penalty_soldier_id)
            take(k.penalty_soldier_id, k.id, ROLE_PERFORMER, a, b)

        cand = [
            sid
            for sid in elig
            if sid not in performers and sid not in res_list and free(sid, a, b)
            and not (cap and not k.is_penalty and month_count[sid, month] >= cap)
        ]
        perf_cand = [sid for sid in cand if nights_ok(sid, k.id)]
        holiday = is_holiday_slot(k, holidays)
        perf_cand.sort(key=lambda sid: (holiday and had_holiday[sid], score[sid] + prep.pts[sid, k.id], weekends[sid], sid))
        while len(performers) < k.performers_needed and perf_cand:
            sid = perf_cand.pop(0)
            cand.remove(sid)
            performers.append(sid)
            take(sid, k.id, ROLE_PERFORMER, a, b)
            score[sid] += prep.pts[sid, k.id]
            weekends[sid] += prep.wk_units[k.id]
            month_count[sid, month] += 1

        if k.reserves_needed and not k.is_penalty:
            gafs = {soldiers[p].gaf_id for p in performers}
            rc = [
                sid
                for sid in cand
                if soldiers[sid].service_type != SERVICE_MANDATORY or soldiers[sid].gaf_id in gafs
            ]
            rc.sort(key=lambda sid: (soldiers[sid].gaf_id not in gafs, reserves[sid], score[sid], sid))
            while len(res_list) < k.reserves_needed and rc:
                sid = rc.pop(0)
                res_list.append(sid)
                take(sid, k.id, ROLE_RESERVE, a, b)
                reserves[sid] += 1
    return chosen
