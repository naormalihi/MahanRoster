"""Solve a long cycle month by month.

A half-year cycle is too large for one CP-SAT model on a small machine, and
nothing is gained by solving it at once: fairness is carried forward through
the running score. Each month is solved with the scores, weekend counts and
reserve counts left by the months before it, and duties near the boundary are
passed on as busy periods so rest rules hold across months.

Month by month is short-sighted where a pool is small and its duties are few and of
different worth: each month is balanced as it stands, but the months to come cannot be
seen, and a pool can end the cycle uneven (all level by April, May's two heavy duties go
to two of them, June's two light ones to two others). So a polish pass follows: for each
pool whose scores still spread, the duties its own members hold are dealt out again among
them over the whole cycle, everything else kept as it is. A polished schedule is kept only
if the pool is more even and no hard rule is broken.
"""

from __future__ import annotations

import time as _time
from collections import defaultdict
from dataclasses import replace
from datetime import timedelta

from .models import ROLE_PERFORMER, ROLE_RESERVE, Absence, CreditOut, Problem, Solution
from .scoring import weekend_units
from .solver import SCALE, build_assignments, pool_stats, prepare, solve
from .verify import violations

STATUS_RANK = {"OPTIMAL": 0, "FEASIBLE": 1, "UNKNOWN": 2, "INFEASIBLE": 3, "MODEL_INVALID": 4}


def windows(problem: Problem) -> list[list]:
    by_month = defaultdict(list)
    for k in problem.slots:
        by_month[k.starts_at.year, k.starts_at.month].append(k)
    return [by_month[key] for key in sorted(by_month)]


def solve_rolling(problem: Problem, log: bool = False, on_progress=None) -> Solution:
    """on_progress(done_windows, total_windows, staffed_slots, total_slots, phase) is called before
    the first month, on each better solution inside a month and after each month, if given: how far
    the run is, in months and in duties staffed. phase: "searching" until a month has a first
    solution, then "improving" (balancing the load) until it is done."""
    t0 = _time.time()
    groups = windows(problem)
    if len(groups) <= 1:
        n = len(problem.slots)
        return solve(problem, log=log, on_solution=(lambda s, _f: on_progress(0, 1, s, n, "improving")) if on_progress else None)

    tasks = {t.id: t for t in problem.task_types}
    per_window_time = max(10.0, problem.settings.time_limit_seconds / len(groups))
    state = {s.id: (s.baseline_score, s.baseline_weekends, s.baseline_reserves) for s in problem.soldiers}
    carried: list[Absence] = []
    chosen: list[tuple[str, str, str]] = []
    unfilled, warnings, statuses = [], [], []
    diagnoses: list = []
    credit_days: dict[str, int] = defaultdict(int)
    credit_pts: dict[str, float] = defaultdict(float)

    total_slots = sum(len(g) for g in groups)
    staffed = 0
    if on_progress:
        on_progress(0, len(groups), 0, total_slots, "searching")
    for i, slots in enumerate(groups):
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
        before = staffed
        sol = solve(
            sub,
            log=log,
            on_solution=(lambda s, _f, i=i, before=before: on_progress(i, len(groups), before + s, total_slots, "improving")) if on_progress else None,
        )
        # a duty counts as staffed once it has all its performers
        got = defaultdict(int)
        for a in sol.assignments:
            if a.role == ROLE_PERFORMER:
                got[a.slot_id] += 1
        staffed += sum(1 for k in slots if got[k.id] >= k.performers_needed)
        if on_progress:
            on_progress(i + 1, len(groups), staffed, total_slots, "searching")
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

    if on_progress:
        on_progress(len(groups), len(groups), staffed, total_slots, "polishing")
    budget = max(20.0, problem.settings.time_limit_seconds * 0.2)
    chosen, polished = polish(problem, chosen, credit_pts, budget, log=log)
    if polished:
        warnings.append(f"ליטוש האיזון: {polished} קבוצות חולקו מחדש על פני כל המחזור")

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


# A pool is polished when its scores spread by more than this many points.
POLISH_SPREAD = 1.0
OK = ("OPTIMAL", "FEASIBLE")


def _pool_state(problem: Problem, prep, chosen, credit_pts, members):
    """Final score and weekend units of each member."""
    score = {sid: next(s for s in problem.soldiers if s.id == sid).baseline_score + credit_pts.get(sid, 0.0) for sid in members}
    wk = {sid: next(s for s in problem.soldiers if s.id == sid).baseline_weekends for sid in members}
    for sid, kid, role in chosen:
        if sid in score and role == ROLE_PERFORMER:
            score[sid] += prep.pts[sid, kid] / SCALE
            wk[sid] += prep.wk_units[kid]
    return score, wk


def _unevenness(score: dict[str, float]) -> tuple[float, float]:
    """(highest score, total distance from the mean) – smaller is more even."""
    v = list(score.values())
    m = sum(v) / len(v)
    return round(max(v), 2), round(sum(abs(x - m) for x in v), 2)


def polish(problem: Problem, chosen: list[tuple[str, str, str]], credit_pts: dict[str, float], budget: float, log: bool = False):
    """Deal again, over the whole cycle, the duties a pool's members hold among themselves.

    For each uneven pool: its "own" slots – those all of whose holders are its members – are
    solved again with the members only; their other duties count as score and as busy time.
    Returns the (possibly) improved schedule and how many pools were improved.
    """
    t_end = _time.time() + budget
    prep = prepare(problem)
    soldiers = {s.id: s for s in problem.soldiers}
    slots = {k.id: k for k in problem.slots}
    tasks = {t.id: t for t in problem.task_types}
    active = {sid for sid, _ in prep.pts}
    pools: dict[str, list[str]] = defaultdict(list)
    for s in problem.soldiers:
        if s.id in active:
            pools[s.pool].append(s.id)

    def broken(ch) -> int:
        sol = Solution(cycle_id=problem.cycle_id, status="X", objective=None, wall_time_seconds=0,
                       assignments=build_assignments(problem, prep, ch, credit_pts))
        return len(violations(problem, sol))

    base_broken = None
    improved = 0
    # the most uneven pools first, while time lasts
    order = sorted(
        (p for p in pools.items() if len(p[1]) > 1),
        key=lambda p: -(lambda sc: max(sc.values()) - min(sc.values()))(_pool_state(problem, prep, chosen, credit_pts, p[1])[0]),
    )
    for pool, members in order:
        left = t_end - _time.time()
        if left < 2:
            break
        score, wk = _pool_state(problem, prep, chosen, credit_pts, members)
        if max(score.values()) - min(score.values()) <= POLISH_SPREAD:
            continue
        mine = set(members)
        holders: dict[str, list[tuple[str, str]]] = defaultdict(list)
        for sid, kid, role in chosen:
            holders[kid].append((sid, role))
        own = {kid for kid, hs in holders.items() if all(sid in mine for sid, _ in hs) and not slots[kid].is_penalty}
        if len(own) < 2:
            continue
        # the members' other duties: part of their score, and time they are taken
        add_pts, add_wk, add_res = defaultdict(float), defaultdict(int), defaultdict(int)
        busy = list(problem.busy)
        for sid, kid, role in chosen:
            if sid in mine and kid not in own:
                k = slots[kid]
                if role == ROLE_PERFORMER:
                    add_pts[sid] += prep.pts[sid, kid] / SCALE
                    add_wk[sid] += prep.wk_units[kid]
                else:
                    add_res[sid] += 1
                busy.append(Absence(sid, k.briefing_at or k.starts_at, k.ends_at + timedelta(hours=tasks[k.task_type_id].min_rest_hours)))
        count = defaultdict(int)
        for kid in own:
            for _, role in holders[kid]:
                count[kid, role] += 1
        sub = replace(
            problem,
            soldiers=[
                replace(
                    soldiers[sid],
                    baseline_score=soldiers[sid].baseline_score + credit_pts.get(sid, 0.0) + add_pts[sid],
                    baseline_weekends=soldiers[sid].baseline_weekends + add_wk[sid],
                    baseline_reserves=soldiers[sid].baseline_reserves + add_res[sid],
                    credit_periods=[],  # the credit is already in the score
                )
                for sid in members
            ],
            slots=[
                replace(slots[kid], performers_needed=count[kid, ROLE_PERFORMER], reserves_needed=count[kid, ROLE_RESERVE])
                for kid in sorted(own)
            ],
            fixed=[f for f in problem.fixed if f.slot_id in own],
            busy=busy,
            settings=replace(problem.settings, time_limit_seconds=min(left, max(5.0, budget / 4))),
        )
        hint = {c for c in chosen if c[1] in own}
        try:
            sol = solve(sub, log=log, hint=hint)
        except Exception:  # polishing must never cost the schedule itself
            continue
        if sol.status not in OK or sol.unfilled:
            continue
        candidate = [c for c in chosen if c[1] not in own] + [(a.soldier_id, a.slot_id, a.role) for a in sol.assignments]
        new_score, new_wk = _pool_state(problem, prep, candidate, credit_pts, members)
        if _unevenness(new_score) >= _unevenness(score) or max(new_wk.values()) > max(wk.values()):
            continue
        if base_broken is None:
            base_broken = broken(chosen)
        if broken(candidate) > base_broken:
            continue
        chosen = candidate
        improved += 1
    return chosen, improved
