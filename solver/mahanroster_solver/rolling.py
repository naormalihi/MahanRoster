"""Solve a long cycle month by month.

A half-year cycle is too large for one CP-SAT model on a small machine, and
nothing is gained by solving it at once: fairness is carried forward through
the running score. Each month is solved with the scores, weekend counts and
reserve counts left by the months before it, and duties near the boundary are
passed on as busy periods so rest rules hold across months.
"""

from __future__ import annotations

import time as _time
from collections import defaultdict
from dataclasses import replace
from datetime import timedelta

from .models import ROLE_PERFORMER, ROLE_RESERVE, Absence, CreditOut, Problem, Solution
from .scoring import weekend_units
from .solver import build_assignments, pool_stats, prepare, solve

STATUS_RANK = {"OPTIMAL": 0, "FEASIBLE": 1, "UNKNOWN": 2, "INFEASIBLE": 3, "MODEL_INVALID": 4}


def windows(problem: Problem) -> list[list]:
    by_month = defaultdict(list)
    for k in problem.slots:
        by_month[k.starts_at.year, k.starts_at.month].append(k)
    return [by_month[key] for key in sorted(by_month)]


def solve_rolling(problem: Problem, log: bool = False, on_progress=None) -> Solution:
    """on_progress(done_windows, total_windows) is called after each month, if given."""
    t0 = _time.time()
    groups = windows(problem)
    if len(groups) <= 1:
        return solve(problem, log=log)

    tasks = {t.id: t for t in problem.task_types}
    per_window_time = max(10.0, problem.settings.time_limit_seconds / len(groups))
    state = {s.id: (s.baseline_score, s.baseline_weekends, s.baseline_reserves) for s in problem.soldiers}
    carried: list[Absence] = []
    chosen: list[tuple[str, str, str]] = []
    unfilled, warnings, statuses = [], [], []
    diagnoses: list = []
    credit_days: dict[str, int] = defaultdict(int)
    credit_pts: dict[str, float] = defaultdict(float)

    for i, slots in enumerate(groups):
        if on_progress:
            on_progress(i, len(groups))
        ids = {k.id for k in slots}
        window_start = min(k.starts_at for k in slots)
        sub = replace(
            problem,
            soldiers=[
                replace(s, baseline_score=state[s.id][0], baseline_weekends=state[s.id][1], baseline_reserves=state[s.id][2])
                for s in problem.soldiers
            ],
            slots=slots,
            fixed=[f for f in problem.fixed if f.slot_id in ids],
            busy=list(problem.busy) + [b for b in carried if b.ends_at > window_start],
            settings=replace(problem.settings, time_limit_seconds=per_window_time),
        )
        sol = solve(sub, log=log)
        statuses.append(sol.status)
        unfilled += sol.unfilled
        warnings += sol.warnings
        diagnoses.append(sol.diagnosis)
        slot_by_id = {k.id: k for k in slots}
        # availability credits of this month go into the running score like points
        for c in sol.credits:
            credit_days[c.soldier_id] += c.days
            credit_pts[c.soldier_id] += c.points
            score, wk, res = state[c.soldier_id]
            state[c.soldier_id] = (score + c.points, wk, res)
        for a in sol.assignments:
            chosen.append((a.soldier_id, a.slot_id, a.role))
            score, wk, res = state[a.soldier_id]
            k = slot_by_id[a.slot_id]
            if a.role == ROLE_PERFORMER:
                score += a.normalized_points
                wk += 0 if k.is_penalty else weekend_units(k.starts_at, k.ends_at, problem.settings, set(problem.holidays))
            elif a.role == ROLE_RESERVE:
                res += 1
            state[a.soldier_id] = (score, wk, res)
            rest = timedelta(hours=tasks[k.task_type_id].min_rest_hours)
            carried.append(Absence(a.soldier_id, k.starts_at, k.ends_at + rest))

    prep = prepare(problem)
    worst = max(statuses, key=lambda s: STATUS_RANK.get(s, 9))
    return Solution(
        cycle_id=problem.cycle_id,
        status=worst,
        objective=None,
        wall_time_seconds=round(_time.time() - t0, 2),
        assignments=build_assignments(problem, prep, chosen, credit_pts),
        unfilled=unfilled,
        pools=pool_stats(problem, prep, chosen, credit_pts),
        credits=[CreditOut(sid, credit_days[sid], round(credit_pts[sid], 2)) for sid in sorted(credit_days)],
        warnings=warnings,
        diagnosis=next((d for d in diagnoses if d), None),
    )
