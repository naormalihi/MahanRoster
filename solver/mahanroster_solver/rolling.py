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
them over the whole cycle, everything else kept as it is. A large pool is too big a model
for that in the time there is, so then single duties are moved instead, one at a time, from
the highest of the pool to the lowest who may take them (rest, cap, gaf rule kept) – e.g.
a regular duty from a soldier who also got a 6-point holiday duty to one left behind. A
polished schedule is kept only if the pool is more even and no hard rule is broken.
"""

from __future__ import annotations

import time as _time
from collections import defaultdict
from dataclasses import replace
from datetime import timedelta

from .models import ROLE_PERFORMER, ROLE_RESERVE, Absence, CreditOut, FixedAssignment, Problem, Solution
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
    if problem.start:
        return _solve_months(problem, groups, log, on_progress, t0)
    if len(groups) <= 1:
        n = len(problem.slots)
        return solve(problem, log=log, on_solution=(lambda s, _f: on_progress(0, 1, s, n, "improving")) if on_progress else None)

    return _solve_months(problem, groups, log, on_progress, t0)


# An update run: time for a month whose draft must be repaired, as a share of a full run's, and
# for a month kept as it is (the model only checks it).
UPDATE_TIME_SHARE = 0.4
KEPT_MONTH_SECONDS = 10.0


def _month_start(sub: Problem, start: list[FixedAssignment]):
    """The draft of one month, the part of it that still holds, and whether that part staffs the
    whole month (so the month is kept as it is)."""
    ids = {k.id for k in sub.slots}
    mine = [f for f in start if f.slot_id in ids]
    prep = prepare(sub)
    slots = {k.id: k for k in sub.slots}
    rest = {t.id: timedelta(hours=t.min_rest_hours) for t in sub.task_types}
    busy = defaultdict(list)  # duties of the months before (repaired ones too) and published ones
    for b in sub.busy:
        busy[b.soldier_id].append(b)

    def free(f) -> bool:
        k = slots[f.slot_id]
        end = k.ends_at + rest[k.task_type_id]
        return not any(b.starts_at < end and k.starts_at < b.ends_at for b in busy[f.soldier_id])

    valid = [f for f in mine if f.soldier_id in prep.eligible.get(f.slot_id, ()) and free(f)]
    have = defaultdict(int)
    for f in valid:
        have[f.slot_id, f.role] += 1
    for f in sub.fixed:
        have[f.slot_id, f.role] += 1
    full = all(
        have[k.id, ROLE_PERFORMER] >= k.performers_needed
        and (k.is_penalty or have[k.id, ROLE_RESERVE] >= k.reserves_needed)
        for k in sub.slots
    )
    return mine, valid, full and len(valid) == len(mine)


def _solve_months(problem: Problem, groups, log, on_progress, t0) -> Solution:
    update = bool(problem.start)
    kept = removed = 0
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
        hint = None
        if update:
            mine, valid, whole = _month_start(sub, problem.start)
            removed += len(mine) - len(valid)
            if whole:
                # every duty of the month still holds: kept as it is
                kept += len(valid)
                sub = replace(sub, fixed=list(sub.fixed) + valid,
                              settings=replace(sub.settings, time_limit_seconds=KEPT_MONTH_SECONDS))
            else:
                hint = {(f.soldier_id, f.slot_id, f.role) for f in valid}
                sub = replace(sub, settings=replace(sub.settings, time_limit_seconds=max(10.0, per_window_time * UPDATE_TIME_SHARE)))
        sol = solve(
            sub,
            log=log,
            on_solution=(lambda s, _f, i=i, before=before: on_progress(i, len(groups), before + s, total_slots, "improving")) if on_progress else None,
            hint=hint,
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
    before_polish = set(chosen)
    chosen, polished = polish(problem, chosen, credit_pts, budget, log=log)
    if polished:
        warnings.append(f"ליטוש האיזון: {polished} קבוצות חולקו מחדש על פני כל המחזור")
    if update:
        draft = {(f.soldier_id, f.slot_id, f.role) for f in problem.start}
        now = set(chosen)
        warnings.insert(0, (
            f"עדכון שיבוץ: {len(draft & now)} שיבוצים נשארו, {removed} הוסרו כי כבר לא חוקיים, "
            f"{len(now - draft)} שובצו מחדש, {len(before_polish - now)} הועברו לאיזון"
        ))

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
# Above this many slots a pool is not solved again as a model, only moved duty by duty.
POLISH_MODEL_SLOTS = 120
OK = ("OPTIMAL", "FEASIBLE")


class _TooBig(Exception):
    pass


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
        candidates = []
        try:
            if len(own) > POLISH_MODEL_SLOTS:
                raise _TooBig  # a large pool: single moves only
            sol = solve(sub, log=log, hint=hint)
            if sol.status in OK and not sol.unfilled:
                candidates.append([c for c in chosen if c[1] not in own] + [(a.soldier_id, a.slot_id, a.role) for a in sol.assignments])
        except Exception:  # polishing must never cost the schedule itself
            pass
        # then single moves, on top of the best so far
        start_from = chosen
        if candidates:
            ns, nw = _pool_state(problem, prep, candidates[0], credit_pts, members)
            if _unevenness(ns) < _unevenness(score) and max(nw.values()) <= max(wk.values()):
                start_from = candidates[0]
        moved = move_duties(problem, prep, start_from, credit_pts, members, deadline=min(t_end, _time.time() + max(3.0, budget / 4)))
        candidates.append(moved)
        best = None
        for candidate in candidates:
            new_score, new_wk = _pool_state(problem, prep, candidate, credit_pts, members)
            if _unevenness(new_score) >= _unevenness(score) or max(new_wk.values()) > max(wk.values()):
                continue
            if best is None or _unevenness(new_score) < best[0]:
                best = (_unevenness(new_score), candidate)
        if best is None:
            continue
        if base_broken is None:
            base_broken = broken(chosen)
        if broken(best[1]) > base_broken:
            continue
        chosen = best[1]
        improved += 1
    return chosen, improved


def move_duties(problem: Problem, prep, chosen: list[tuple[str, str, str]], credit_pts: dict[str, float], members: list[str], deadline: float):
    """Move single performer duties from the highest of a pool to the lowest who may take them.

    A move is made only when it lowers the pool's unevenness; the receiver must be eligible,
    free with rest on both sides, under the monthly cap, not above the pool's weekend maximum,
    and a mandatory reserve on the slot must still share a performer's gaf. Published, manual
    and penalty duties, and slots the base marked ת"ש 7, stay where they are.
    """
    soldiers = {s.id: s for s in problem.soldiers}
    slots = {k.id: k for k in problem.slots}
    rest = {t.id: timedelta(hours=t.min_rest_hours) for t in problem.task_types}
    fixed = {(f.soldier_id, f.slot_id, f.role) for f in problem.fixed}
    cap = problem.settings.duty_cap_per_month
    chosen = list(chosen)

    def window(kid):
        k = slots[kid]
        return k.briefing_at or k.starts_at, k.ends_at + rest[k.task_type_id]

    held: dict[str, set[str]] = defaultdict(set)  # soldier → slots he holds (any role)
    holders: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for sid, kid, role in chosen:
        held[sid].add(kid)
        holders[kid].append((sid, role))
    score, wk = _pool_state(problem, prep, chosen, credit_pts, members)
    wk_max = max(wk.values())

    def free(sid, kid) -> bool:
        a0, a1 = window(kid)
        for j in held[sid]:
            b0, b1 = window(j)
            if a0 < b1 and b0 < a1:
                return False
        return True

    def under_cap(sid, kid) -> bool:
        if not cap or slots[kid].is_penalty:
            return True
        k = slots[kid]
        n = sum(1 for j in held[sid] for s2, r2 in holders[j] if s2 == sid and r2 == ROLE_PERFORMER
                and not slots[j].is_penalty and (slots[j].starts_at.year, slots[j].starts_at.month) == (k.starts_at.year, k.starts_at.month))
        return n < cap

    def gaf_ok(kid, giver, taker) -> bool:
        perf = [sid for sid, r in holders[kid] if r == ROLE_PERFORMER and sid != giver] + [taker]
        gafs = {soldiers[sid].gaf_id for sid in perf}
        for sid, r in holders[kid]:
            if r == ROLE_RESERVE and (sid, kid, r) not in fixed and soldiers[sid].service_type == "mandatory" and soldiers[sid].gaf_id not in gafs:
                return False
        return True

    while _time.time() < deadline:
        before = _unevenness(score)
        best = None
        high = sorted(members, key=lambda s: -score[s])[: max(3, len(members) // 4)]
        low = sorted(members, key=lambda s: score[s])
        for h in high:
            for kid in held[h]:
                if (h, kid, ROLE_PERFORMER) in fixed or (h, ROLE_PERFORMER) not in holders[kid]:
                    continue
                k = slots[kid]
                if k.is_penalty or k.prefer_home_nightly:
                    continue
                for l in low:
                    if l == h or score[l] >= score[h] or (l, kid) not in prep.pts or kid in held[l]:
                        continue
                    trial = dict(score)
                    trial[h] -= prep.pts[h, kid] / SCALE
                    trial[l] += prep.pts[l, kid] / SCALE
                    after = _unevenness(trial)
                    if after >= before or (best and after >= best[0]):
                        continue
                    if wk[l] + prep.wk_units[kid] > wk_max:
                        continue
                    if not (free(l, kid) and under_cap(l, kid) and gaf_ok(kid, h, l)):
                        continue
                    best = (after, h, l, kid)
        if best is None:
            break
        _, h, l, kid = best
        chosen.remove((h, kid, ROLE_PERFORMER))
        chosen.append((l, kid, ROLE_PERFORMER))
        holders[kid].remove((h, ROLE_PERFORMER))
        holders[kid].append((l, ROLE_PERFORMER))
        held[h].discard(kid)
        held[l].add(kid)
        score[h] -= prep.pts[h, kid] / SCALE
        score[l] += prep.pts[l, kid] / SCALE
        wk[h] -= prep.wk_units[kid]
        wk[l] += prep.wk_units[kid]
    return chosen
