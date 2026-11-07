"""CP-SAT scheduling model.

Decision variables, per eligible (soldier, slot) pair:
    x[s, k] – soldier s performs slot k
    r[s, k] – soldier s is a reserve for slot k

Hard constraints
    * coverage: performers and reserves per slot (shortage goes to slack
      variables with a huge penalty, so the model never fails – the report
      says which slots are unfilled and why)
    * one role per soldier per slot
    * rest: per soldier, intervals [start, end + rest of that duty] of every
      duty or reserve role may not overlap (reserve counts as if activated)
    * mandatory-service reserve comes from the performer's gaf
    * fixed assignments (manual locks, penalty slots, published slots)
    * optional monthly cap of duties per soldier

Soft objective, inside each fairness pool (the soldier's fairness group – soldiers of
one population who can share load – or else the population):
    expected score E_s = baseline_s + credit_s + normalized points assigned this cycle
    where credit_s = the pool's average load per available day × the days the soldier
    is out of the unit not by choice (see availability_credits)
    minimize max E_s, the L1 spread of E_s around the pool mean, the max
    number of weekend/holiday units, the max number of reserve roles,
    consecutive weekends, several duties in one week, career reserves
    from another gaf, and "ת"ש 7" slots given to soldiers who are not ת"ש 7.

All quantities are scaled to integers (points × 100) for CP-SAT.
"""

from __future__ import annotations

import os
import time as _time
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from statistics import mean, pstdev
from typing import Optional

from .eligibility import EligibilityIndex
from .models import (
    ROLE_PERFORMER,
    ROLE_RESERVE,
    SERVICE_MANDATORY,
    AssignmentOut,
    CreditOut,
    PoolStats,
    Problem,
    Solution,
    UnfilledOut,
)
from .scoring import normalized_points, raw_points, weekend_units

SCALE = 100
UNFILLED_PERFORMER_PENALTY = 10**9
UNFILLED_RESERVE_PENALTY = 10**8


@dataclass
class Prepared:
    """Everything derived from the problem before building the model."""

    eligible: dict[str, list[str]]  # slot_id -> soldier ids
    reasons: dict[str, dict[str, int]]  # slot_id -> reason -> count
    pts: dict[tuple[str, str], int]  # (soldier, slot) -> scaled normalized points
    raw: dict[str, float]  # slot_id -> raw points
    wk_units: dict[str, int]  # slot_id -> weekend/holiday units
    warnings: list[str]


def prepare(problem: Problem) -> Prepared:
    idx = EligibilityIndex(problem)
    holidays = set(problem.holidays)
    settings = problem.settings
    tasks = idx.tasks
    soldiers = {s.id: s for s in problem.soldiers}
    fixed_by_slot = defaultdict(list)
    for f in problem.fixed:
        fixed_by_slot[f.slot_id].append(f)

    eligible, reasons, pts, raw, wk = {}, {}, {}, {}, {}
    warnings: list[str] = []
    for slot in problem.slots:
        task = tasks[slot.task_type_id]
        raw[slot.id] = 0.0 if slot.is_penalty else raw_points(task, slot.starts_at, slot.ends_at, settings, holidays)
        wk[slot.id] = 0 if slot.is_penalty else weekend_units(slot.starts_at, slot.ends_at, settings, holidays)
        ok, why = [], defaultdict(int)
        for s in problem.soldiers:
            r = idx.check(s, slot)
            if r:
                for code in r:
                    why[code] += 1
            else:
                ok.append(s.id)
        # A fixed assignment is kept even if the soldier is no longer eligible – with a warning.
        for f in fixed_by_slot.get(slot.id, ()):
            if f.soldier_id not in soldiers:
                warnings.append(f"שיבוץ קבוע במשבצת {slot.id} לחייל לא מוכר {f.soldier_id} – הושמט")
                continue
            if f.soldier_id not in ok:
                r = idx.check(soldiers[f.soldier_id], slot)
                warnings.append(f"שיבוץ קבוע במשבצת {slot.id} לחייל {f.soldier_id} מפר: {', '.join(r)}")
                ok.append(f.soldier_id)
        if slot.is_penalty and slot.penalty_soldier_id:
            r = [c for c in _personal_conflicts(idx, soldiers.get(slot.penalty_soldier_id), slot)]
            if r:
                warnings.append(f"משבצת קנס {slot.id} מתנגשת אצל {slot.penalty_soldier_id}: {', '.join(r)}")
        eligible[slot.id] = ok
        reasons[slot.id] = dict(why)
        for sid in ok:
            s = soldiers[sid]
            pts[(sid, slot.id)] = (
                0
                if slot.is_penalty
                else round(SCALE * normalized_points(s, task, slot.starts_at, slot.ends_at, settings, holidays))
            )
    return Prepared(eligible, reasons, pts, raw, wk, warnings)


def _personal_conflicts(idx: EligibilityIndex, soldier, slot) -> list[str]:
    """For a penalty slot: check the soldier's exemptions/absences/blocks as if it were a normal slot."""
    if soldier is None:
        return ["unknown_soldier"]
    from dataclasses import replace

    probe = replace(slot, is_penalty=False)
    keep = {"exemption", "absence", "date_block", "released", "not_enlisted"}
    return [r for r in idx.check(soldier, probe) if r in keep]


def _pool_load(prep: Prepared, members: list[str], by_soldier, slots) -> float:
    """Scaled points this pool is expected to absorb in the cycle (performer roles only)."""
    member_set = set(members)
    load = 0.0
    seen = set()
    for sid in members:
        for kid in by_soldier[sid]:
            if kid in seen:
                continue
            seen.add(kid)
            elig = prep.eligible[kid]
            inside = [s for s in elig if s in member_set]
            if not inside:
                continue
            share = len(inside) / len(elig)
            load += share * slots[kid].performers_needed * sum(prep.pts[s, kid] for s in inside) / len(inside)
    return load


def availability_credits(problem: Problem, prep: Prepared) -> dict[str, tuple[int, int]]:
    """Per soldier: (credited days, scaled credit) for the days of this run's slots.

    The pool's expected load is shared among its soldiers in proportion to the days each
    is available; a credited day is worth the pool's average load per available day.
    """
    if not problem.slots:
        return {}
    first = min(k.starts_at.date() for k in problem.slots)
    last = max(k.starts_at.date() for k in problem.slots)
    span = (last - first).days + 1
    slots = {k.id: k for k in problem.slots}
    by_soldier = defaultdict(list)
    for sid, kid in prep.pts:
        by_soldier[sid].append(kid)
    members = defaultdict(list)
    for s in problem.soldiers:
        members[s.pool].append(s)
    out: dict[str, tuple[int, int]] = {}
    for pool, ss in members.items():
        days = {s.id: s.credited_days(first, last) for s in ss}
        if not any(days.values()):
            continue
        load = _pool_load(prep, [s.id for s in ss if s.id in by_soldier], by_soldier, slots)
        available = sum(span - d for d in days.values())
        rate = load / available if available > 0 else 0.0
        for s in ss:
            if days[s.id]:
                out[s.id] = (days[s.id], round(rate * days[s.id]))
    return out


def _thresholds(base: dict[str, int], bound: dict[str, int], pool_load: float, step: int = SCALE) -> range:
    """Staircase thresholds covering the scores the pool can realistically reach."""
    lo = min(base.values())
    level = sorted(base.values())
    # Water level if the load were spread perfectly from the bottom up.
    remaining, water = pool_load, lo
    for i, b in enumerate(level):
        nxt = level[i + 1] if i + 1 < len(level) else None
        width = i + 1
        if nxt is None or remaining <= (nxt - b) * width:
            water = b + remaining / width
            break
        remaining -= (nxt - b) * width
    hi = min(max(bound.values()), int(water) + 8 * step)
    start = (lo // step) * step
    return range(start, hi + step, step)


def _minutes(t: datetime, origin: datetime) -> int:
    return int((t - origin).total_seconds() // 60)


def _week_key(d: date) -> tuple[int, int]:
    """Israeli week (Sunday–Saturday)."""
    sunday = d - timedelta(days=(d.weekday() + 1) % 7)
    return sunday.isocalendar()[:2]


def _weekend_key(d: date) -> date:
    """The Friday that opens the weekend a day belongs to."""
    return d - timedelta(days=(d.weekday() - 4) % 7)


def solve(problem: Problem, log: bool = False) -> Solution:
    from ortools.sat.python import cp_model  # imported lazily so the rest works without OR-Tools

    t0 = _time.time()
    prep = prepare(problem)
    settings = problem.settings
    w = settings.weights
    soldiers = {s.id: s for s in problem.soldiers}
    tasks = {t.id: t for t in problem.task_types}
    slots = {k.id: k for k in problem.slots}
    origin = datetime.combine(problem.cycle_start, datetime.min.time()) - timedelta(days=7)

    m = cp_model.CpModel()
    x: dict[tuple[str, str], cp_model.IntVar] = {}
    r: dict[tuple[str, str], cp_model.IntVar] = {}
    unfilled_p: dict[str, cp_model.IntVar] = {}
    unfilled_r: dict[str, cp_model.IntVar] = {}

    fixed = {(f.soldier_id, f.slot_id): f.role for f in problem.fixed if f.soldier_id in soldiers}

    for k in problem.slots:
        elig = prep.eligible[k.id]
        for sid in elig:
            x[sid, k.id] = m.NewBoolVar(f"x_{sid}_{k.id}")
            if k.reserves_needed > 0 and not k.is_penalty:
                r[sid, k.id] = m.NewBoolVar(f"r_{sid}_{k.id}")
                m.Add(x[sid, k.id] + r[sid, k.id] <= 1)
        unfilled_p[k.id] = m.NewIntVar(0, k.performers_needed, f"up_{k.id}")
        m.Add(sum(x[sid, k.id] for sid in elig) + unfilled_p[k.id] == k.performers_needed)
        if k.reserves_needed > 0 and not k.is_penalty:
            unfilled_r[k.id] = m.NewIntVar(0, k.reserves_needed, f"ur_{k.id}")
            m.Add(sum(r[sid, k.id] for sid in elig) + unfilled_r[k.id] == k.reserves_needed)

    # Fixed assignments and penalty slots.
    for (sid, kid), role in fixed.items():
        var = (x if role == ROLE_PERFORMER else r).get((sid, kid))
        if var is not None:
            m.Add(var == 1)
    for k in problem.slots:
        if k.is_penalty and k.penalty_soldier_id and (k.penalty_soldier_id, k.id) in x:
            m.Add(x[k.penalty_soldier_id, k.id] == 1)

    # Rest and no overlap, per soldier.
    by_soldier = defaultdict(list)
    for (sid, kid) in x:
        by_soldier[sid].append(kid)
    present: dict[tuple[str, str], object] = {}
    for sid, kids in by_soldier.items():
        intervals = []
        for kid in kids:
            k = slots[kid]
            if (sid, kid) in r:
                y = m.NewBoolVar(f"y_{sid}_{kid}")
                m.Add(y == x[sid, kid] + r[sid, kid])
            else:
                y = x[sid, kid]
            present[sid, kid] = y
            start = _minutes(k.starts_at, origin)
            end = _minutes(k.ends_at, origin) + 60 * tasks[k.task_type_id].min_rest_hours
            intervals.append(m.NewOptionalIntervalVar(start, end - start, end, y, f"i_{sid}_{kid}"))
        if len(intervals) > 1:
            m.AddNoOverlap(intervals)

    # Reserve from the performer's gaf: hard for mandatory reserves, soft for career reserves.
    cross_gaf_terms = []
    for k in problem.slots:
        if k.id not in unfilled_r:
            continue
        elig = prep.eligible[k.id]
        gafs = defaultdict(list)
        for sid in elig:
            gafs[soldiers[sid].gaf_id].append(sid)
        z = {}
        for g, members in gafs.items():
            z[g] = m.NewBoolVar(f"z_{k.id}_{g}")
            for sid in members:
                m.Add(z[g] >= x[sid, k.id])
            m.Add(z[g] <= sum(x[sid, k.id] for sid in members))
        for sid in elig:
            g = soldiers[sid].gaf_id
            if soldiers[sid].service_type == SERVICE_MANDATORY:
                m.Add(r[sid, k.id] <= z[g])
            else:
                c = m.NewBoolVar(f"cg_{sid}_{k.id}")
                m.Add(c >= r[sid, k.id] - z[g])
                cross_gaf_terms.append((sid, c))

    # Monthly cap.
    if settings.duty_cap_per_month:
        per_month = defaultdict(list)
        for (sid, kid), v in x.items():
            k = slots[kid]
            if not k.is_penalty:
                per_month[sid, k.starts_at.year, k.starts_at.month].append(v)
        for vars_ in per_month.values():
            m.Add(sum(vars_) <= settings.duty_cap_per_month)

    # ---- fairness, per pool ---------------------------------------------------
    pools = defaultdict(list)
    for s in problem.soldiers:
        if s.id in by_soldier:  # only soldiers who can take part in this cycle are balanced
            pools[s.pool].append(s.id)
    credit = availability_credits(problem, prep)

    objective = []
    objective += [UNFILLED_PERFORMER_PENALTY * v for v in unfilled_p.values()]
    objective += [UNFILLED_RESERVE_PENALTY * v for v in unfilled_r.values()]

    def coef(weight: float, mult: float = 1) -> int:
        """Integer objective coefficient (weights keep one decimal of precision)."""
        return int(round(weight * 10 * mult))

    pool_of = {}
    expected = {}
    for pool, members in pools.items():
        n = len(members)
        for sid in members:
            pool_of[sid] = (pool, n)
        base = {sid: max(0, round(SCALE * soldiers[sid].baseline_score)) + credit.get(sid, (0, 0))[1] for sid in members}
        bound = {sid: base[sid] + sum(prep.pts[sid, kid] for kid in by_soldier[sid]) for sid in members}
        hi_bound = max(bound.values())
        for sid in members:
            e = m.NewIntVar(base[sid], bound[sid], f"E_{sid}")
            m.Add(e == base[sid] + sum(prep.pts[sid, kid] * x[sid, kid] for kid in by_soldier[sid]))
            expected[sid] = e
        e_max = m.NewIntVar(0, hi_bound, f"Emax_{pool}")
        for sid in members:
            m.Add(e_max >= expected[sid])
        objective.append(coef(w.max_score) * e_max)

        # Spread: a convex staircase cost Σ_j max(0, E_s − t_j) over thresholds one point apart.
        # Its slope grows with the score, so each extra point costs more for a soldier who is
        # already high – the solver fills from the bottom up ("water filling") without needing
        # the pool mean as a variable, which keeps the model light.
        thresholds = _thresholds(base, bound, _pool_load(prep, members, by_soldier, slots))
        for sid in members:
            steps_below = 0
            for t in thresholds:
                if t <= base[sid]:
                    steps_below += 1  # max(0, E − t) = E − t: a linear term on E
                elif t < bound[sid]:
                    over = m.NewIntVar(0, bound[sid] - t, f"o_{sid}_{t}")
                    m.Add(over >= expected[sid] - t)
                    objective.append(coef(w.deviation) * over)
            if steps_below:
                objective.append(coef(w.deviation) * steps_below * expected[sid])

        # Weekend/holiday units and reserve roles: minimize the maximum in the pool.
        wk_max = m.NewIntVar(0, 10_000, f"WKmax_{pool}")
        res_max = m.NewIntVar(0, 10_000, f"RESmax_{pool}")
        for sid in members:
            s = soldiers[sid]
            m.Add(
                wk_max
                >= s.baseline_weekends + sum(prep.wk_units[kid] * x[sid, kid] for kid in by_soldier[sid] if prep.wk_units[kid])
            )
            m.Add(res_max >= s.baseline_reserves + sum(r[sid, kid] for kid in by_soldier[sid] if (sid, kid) in r))
        objective.append(coef(w.weekend * SCALE) * wk_max)
        objective.append(coef(w.reserve * SCALE) * res_max)

    # Spread: consecutive weekends and several duties in one week.
    for sid, kids in by_soldier.items():
        if sid not in pool_of:
            continue
        _, n = pool_of[sid]
        weekends = defaultdict(list)
        weeks = defaultdict(list)
        for kid in kids:
            k = slots[kid]
            if k.is_penalty:
                continue
            weeks[_week_key(k.starts_at.date())].append(x[sid, kid])
            if prep.wk_units[kid]:
                weekends[_weekend_key(k.starts_at.date())].append(x[sid, kid])
        on = {}
        for fri, vars_ in weekends.items():
            on[fri] = m.NewBoolVar(f"wk_{sid}_{fri}")
            m.AddMaxEquality(on[fri], vars_)
        for fri in on:
            nxt = fri + timedelta(days=7)
            if nxt in on:
                b = m.NewBoolVar(f"cw_{sid}_{fri}")
                m.Add(b >= on[fri] + on[nxt] - 1)
                objective.append(coef(w.consecutive_weekends * SCALE) * b)
        for key, vars_ in weeks.items():
            if len(vars_) > 1:
                ex = m.NewIntVar(0, len(vars_), f"wx_{sid}_{key[0]}_{key[1]}")
                m.Add(ex >= sum(vars_) - 1)
                objective.append(coef(w.same_week * SCALE) * ex)
    for sid, c in cross_gaf_terms:
        n = pool_of.get(sid, ("", 1))[1]
        objective.append(coef(w.cross_gaf_reserve * SCALE) * c)
    # "ת"ש 7" slots: prefer soldiers who must be home nightly; anyone else costs a penalty.
    for k in problem.slots:
        if not k.prefer_home_nightly:
            continue
        for sid in prep.eligible[k.id]:
            if not soldiers[sid].home_nightly:
                objective.append(coef(w.home_nightly_preference * SCALE) * x[sid, k.id])
                if (sid, k.id) in r:
                    objective.append(coef(w.home_nightly_preference * SCALE) * r[sid, k.id])

    m.Minimize(sum(objective))

    # Start from a full, valid greedy schedule.
    from .greedy import greedy

    start = set(greedy(problem, prep))
    for key, v in x.items():
        m.AddHint(v, int((key[0], key[1], ROLE_PERFORMER) in start))
    for key, v in r.items():
        m.AddHint(v, int((key[0], key[1], ROLE_RESERVE) in start))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = settings.time_limit_seconds
    solver.parameters.num_search_workers = max(1, min(settings.workers, os.cpu_count() or 1))
    solver.parameters.random_seed = settings.random_seed
    solver.parameters.log_search_progress = log
    status = solver.Solve(m)
    status_name = solver.StatusName(status)

    sol = Solution(
        cycle_id=problem.cycle_id,
        status=status_name,
        objective=solver.ObjectiveValue() if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else None,
        wall_time_seconds=round(_time.time() - t0, 2),
        warnings=list(prep.warnings),
    )
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return sol

    chosen = []
    for (sid, kid), v in x.items():
        if solver.Value(v):
            chosen.append((sid, kid, ROLE_PERFORMER))
    for (sid, kid), v in r.items():
        if solver.Value(v):
            chosen.append((sid, kid, ROLE_RESERVE))
    credits = {sid: v / SCALE for sid, (_, v) in credit.items()}
    sol.assignments = build_assignments(problem, prep, chosen, credits)
    for k in problem.slots:
        for role, var in ((ROLE_PERFORMER, unfilled_p.get(k.id)), (ROLE_RESERVE, unfilled_r.get(k.id))):
            if var is not None and solver.Value(var) > 0:
                sol.unfilled.append(
                    UnfilledOut(k.id, role, solver.Value(var), len(prep.eligible[k.id]), prep.reasons[k.id])
                )
    sol.pools = pool_stats(problem, prep, chosen, credits)
    sol.credits = [CreditOut(sid, d, round(v / SCALE, 2)) for sid, (d, v) in sorted(credit.items())]
    return sol


def build_assignments(
    problem: Problem, prep: Prepared, chosen: list[tuple[str, str, str]], credits: Optional[dict[str, float]] = None
) -> list[AssignmentOut]:
    """Attach points and a short explanation to every chosen assignment.

    The explanation compares the soldier's running score just before the duty
    with the running mean of the soldier's pool at that moment.
    """
    soldiers = {s.id: s for s in problem.soldiers}
    slots = {k.id: k for k in problem.slots}
    credits = credits or {}
    running = {s.id: s.baseline_score + credits.get(s.id, 0.0) for s in problem.soldiers}
    active = {sid for sid, _ in prep.pts}  # same population basis as pool_stats
    pool_members = defaultdict(list)
    for s in problem.soldiers:
        if s.id in active:
            pool_members[s.pool].append(s.id)

    out = []
    for sid, kid, role in sorted(chosen, key=lambda c: (slots[c[1]].starts_at, c[2] != ROLE_PERFORMER, c[0])):
        k = slots[kid]
        s = soldiers[sid]
        pool = pool_members[s.pool]
        avg = mean(running[p] for p in pool)
        norm = prep.pts[sid, kid] / SCALE if role == ROLE_PERFORMER else 0.0
        if k.is_penalty:
            why = "משבצת קנס שהבסיס הקצה – ללא ניקוד"
        elif role == ROLE_PERFORMER:
            why = f"שובץ כי הניקוד שלו {running[sid]:.1f} לעומת ממוצע האוכלוסייה {avg:.1f}"
        else:
            why = f"עתודה – הניקוד שלו {running[sid]:.1f} לעומת ממוצע האוכלוסייה {avg:.1f}"
        out.append(
            AssignmentOut(
                slot_id=kid,
                soldier_id=sid,
                role=role,
                points=round(prep.raw[kid], 2) if role == ROLE_PERFORMER else 0.0,
                normalized_points=round(norm, 2),
                explanation=why,
            )
        )
        running[sid] += norm
    return out


def pool_stats(
    problem: Problem, prep: Prepared, chosen: list[tuple[str, str, str]], credits: Optional[dict[str, float]] = None
) -> list[PoolStats]:
    credits = credits or {}
    after = {s.id: s.baseline_score + credits.get(s.id, 0.0) for s in problem.soldiers}
    weekends = {s.id: s.baseline_weekends for s in problem.soldiers}
    reserves = {s.id: s.baseline_reserves for s in problem.soldiers}
    active = {sid for sid, kid in prep.pts}
    for sid, kid, role in chosen:
        if role == ROLE_PERFORMER:
            after[sid] += prep.pts[sid, kid] / SCALE
            weekends[sid] += prep.wk_units[kid]
        else:
            reserves[sid] += 1
    pools = defaultdict(list)
    for s in problem.soldiers:
        if s.id in active:
            pools[s.pool].append(s)
    stats = []
    for pool, members in sorted(pools.items()):
        a = [after[s.id] for s in members]
        stats.append(
            PoolStats(
                population=pool,
                soldiers=len(members),
                mean_before=round(mean(s.baseline_score for s in members), 2),
                mean_after=round(mean(a), 2),
                min_after=round(min(a), 2),
                max_after=round(max(a), 2),
                stdev_after=round(pstdev(a), 2),
                max_weekends=max(weekends[s.id] for s in members),
                max_reserves=max(reserves[s.id] for s in members),
            )
        )
    return stats


def solution_from(problem: Problem, chosen: list[tuple[str, str, str]], status: str = "EXTERNAL") -> Solution:
    """Build a Solution from an externally supplied assignment list (used by tests and the verifier)."""
    prep = prepare(problem)
    missing = [c for c in chosen if (c[0], c[1]) not in prep.pts]
    if missing:
        raise ValueError(f"assignments to ineligible pairs: {missing[:5]}")
    return Solution(
        cycle_id=problem.cycle_id,
        status=status,
        objective=None,
        wall_time_seconds=0.0,
        assignments=build_assignments(problem, prep, chosen),
        pools=pool_stats(problem, prep, chosen),
        warnings=prep.warnings,
    )
