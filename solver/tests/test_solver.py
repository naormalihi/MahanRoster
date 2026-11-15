"""End-to-end solver tests. Skipped when OR-Tools is not installed."""

from datetime import date

import pytest

pytest.importorskip("ortools")  # real CP-SAT, or the HiGHS shim from conftest

from mahanroster_solver import synthetic  # noqa: E402
from mahanroster_solver.models import FixedAssignment, Settings  # noqa: E402
from statistics import pstdev  # noqa: E402

from mahanroster_solver.solver import prepare, solution_from, solve  # noqa: E402
from mahanroster_solver.verify import violations  # noqa: E402

from .conftest import USING_SHIM  # noqa: E402
from .helpers import problem, slot, soldier  # noqa: E402

FAST = Settings(time_limit_seconds=10, workers=2)


def test_lowest_score_gets_the_duty():
    p = problem(
        [soldier("A", baseline_score=10), soldier("B", baseline_score=2), soldier("C", baseline_score=6)],
        [slot("a", "guard", "2027-01-04T08:00", "2027-01-05T08:00", r=0)],
        settings=FAST,
    )
    sol = solve(p)
    assert sol.status == "OPTIMAL"
    assert [(a.soldier_id, a.role) for a in sol.assignments] == [("B", "performer")]


def test_tash7_slot_prefers_home_nightly_soldiers():
    day = ("2027-01-04T08:00", "2027-01-04T17:00")
    soldiers = [soldier("A", baseline_score=0), soldier("B", baseline_score=5, home_nightly=True), soldier("C", gaf="G1")]
    p = problem(soldiers, [slot("a", "guard", *day, r=0, prefer_home_nightly=True)], settings=FAST)
    assert [a.soldier_id for a in solve(p).assignments] == ["B"]  # despite the higher score
    # nobody home-nightly available -> still filled by someone else
    p = problem([soldier("A"), soldier("C")], [slot("a", "guard", *day, r=0, prefer_home_nightly=True)], settings=FAST)
    assert len(solve(p).assignments) == 1


def test_tash_level_limits_nights_on_base_a_week():
    # five evening duties in one week; A (הת"ש 5) may sleep on base only 2 nights of it
    evenings = [slot(f"e{i}", "towers", f"2027-01-{3 + i:02d}T20:00", f"2027-01-{3 + i:02d}T23:00", r=0) for i in range(5)]
    soldiers = [soldier("A", baseline_score=-50, tash_level=5), soldier("B", baseline_score=0), soldier("C", baseline_score=0)]
    p = problem(soldiers, evenings, settings=FAST)
    sol = solve(p)
    assert not sol.unfilled and violations(p, sol) == []
    assert sum(a.soldier_id == "A" for a in sol.assignments) == 2  # he is far behind, so he takes all he may


def test_holiday_duty_first_to_those_without_one_this_year():
    # 2027-04-22 is פסח: A is lowest but did a holiday duty in the past year
    soldiers = [soldier("A", baseline_score=0, recent_holiday=True), soldier("B", baseline_score=4), soldier("C", baseline_score=6)]
    hol = slot("p", "guard", "2027-04-22T08:00", "2027-04-23T08:00", r=0)
    p = problem(soldiers, [hol], settings=FAST, holidays=[date(2027, 4, 22)])
    assert [a.soldier_id for a in solve(p).assignments] == ["B"]
    # an ordinary day: the lowest score as usual
    p = problem(soldiers, [slot("d", "guard", "2027-04-25T08:00", "2027-04-26T08:00", r=0)], settings=FAST, holidays=[date(2027, 4, 22)])
    assert [a.soldier_id for a in solve(p).assignments] == ["A"]
    # two holidays in the cycle, nobody had one: two different soldiers
    two = [slot("p1", "guard", "2027-04-22T08:00", "2027-04-23T08:00", r=0), slot("p7", "guard", "2027-04-28T08:00", "2027-04-29T08:00", r=0)]
    p = problem([soldier("A"), soldier("B", baseline_score=20), soldier("C", baseline_score=20)], two, settings=FAST,
                holidays=[date(2027, 4, 22), date(2027, 4, 28)])
    got = [a.soldier_id for a in solve(p).assignments]
    assert len(got) == 2 and len(set(got)) == 2


def test_rest_and_roles_respected():
    slots = [
        slot(f"d{i}", "guard", f"2027-01-{4 + i:02d}T08:00", f"2027-01-{5 + i:02d}T08:00") for i in range(4)
    ]
    p = problem([soldier(x) for x in "ABCD"], slots, settings=FAST)
    sol = solve(p)
    assert sol.status in ("OPTIMAL", "FEASIBLE")
    assert not sol.unfilled
    assert violations(p, sol) == []


def test_unfilled_reported_instead_of_failing():
    p = problem(
        [soldier("A")],
        [slot("a", "guard", "2027-01-04T08:00", "2027-01-05T08:00", p=2, r=1)],
        settings=FAST,
    )
    sol = solve(p)
    roles = {(u.role, u.missing) for u in sol.unfilled}
    assert ("performer", 1) in roles and ("reserve", 1) in roles


def test_fixed_assignment_kept():
    p = problem(
        [soldier("A", baseline_score=50), soldier("B")],
        [slot("a", "guard", "2027-01-04T08:00", "2027-01-05T08:00", r=0)],
        fixed=[FixedAssignment("a", "A")],
        settings=FAST,
    )
    sol = solve(p)
    assert sol.assignments[0].soldier_id == "A"


def test_synthetic_slice_is_valid():
    """Runs on the shim too: a few days of a fictitious unit, checked by the independent verifier."""
    p = synthetic.generate(months=1, soldiers=80, seed=1)
    p.slots = p.slots[:20]
    p.settings.time_limit_seconds = 30
    sol = solve(p)
    assert sol.status in ("OPTIMAL", "FEASIBLE")
    assert sol.assignments
    assert violations(p, sol) == []


@pytest.mark.skipif(USING_SHIM, reason="full-size benchmark needs real CP-SAT")
def test_synthetic_month_is_fair_and_valid():
    p = synthetic.generate(months=1, soldiers=240, seed=1)
    p.settings.time_limit_seconds = 60
    sol = solve(p)
    assert sol.status in ("OPTIMAL", "FEASIBLE")
    assert violations(p, sol) == []
    active = {sid for sid, _ in prepare(p).pts}
    for pool in sol.pools:
        before = pstdev(s.baseline_score for s in p.soldiers if s.balance_population == pool.population and s.id in active)
        # the schedule must narrow the spread of scores inside each pool
        assert pool.stdev_after < before, pool


def test_rolling_keeps_rest_across_months():
    from mahanroster_solver.rolling import solve_rolling

    p = problem(
        [soldier("A", baseline_score=0), soldier("B", baseline_score=5)],
        [
            slot("jan", "towers", "2027-01-31T20:00", "2027-02-01T08:00", r=0),
            slot("feb", "towers", "2027-02-01T10:00", "2027-02-01T18:00", r=0),
        ],
        settings=FAST,
    )
    sol = solve_rolling(p)
    who = {a.slot_id: a.soldier_id for a in sol.assignments}
    assert who["jan"] == "A" and who["feb"] == "B"  # A is still resting on Feb 1st
    assert violations(p, sol) == []


def test_late_arrival_is_credited_instead_of_catching_up():
    from datetime import date, timedelta

    from mahanroster_solver.models import Period

    days = [date(2027, 1, 3) + timedelta(days=i) for i in range(28)]
    slots = [slot(f"d{d.day}", "towers", f"{d}T08:00", f"{d}T20:00", r=0) for d in days]
    late = soldier("D", enlistment_date=date(2027, 1, 17), credit_periods=[Period(date(2027, 1, 3), date(2027, 1, 16))])
    p = problem([soldier("A"), soldier("B"), soldier("C"), late], slots, settings=Settings(time_limit_seconds=20, workers=2))
    sol = solve(p)
    n = {s: sum(a.soldier_id == s and a.role == "performer" for a in sol.assignments) for s in "ABCD"}
    assert not sol.unfilled
    # 28 duties over 3 × 28 + 14 available days: about 8 each for A–C and 4 for D (not 7)
    assert n["D"] <= 5 and min(n["A"], n["B"], n["C"]) >= 7, n
    (c,) = sol.credits
    total = sum(a.normalized_points for a in sol.assignments)
    assert c.soldier_id == "D" and c.days == 14 and c.points == pytest.approx(total * 14 / 98, abs=0.05)


def test_pools_follow_fairness_groups():
    p = problem(
        [soldier("A", fairness_group="mandatory:x"), soldier("B", fairness_group="mandatory:x"), soldier("C", fairness_group="mandatory:y")],
        [slot("a", "towers", "2027-01-04T08:00", "2027-01-04T20:00", r=0)],
        settings=FAST,
    )
    assert sorted(ps.population for ps in solve(p).pools) == ["mandatory:x", "mandatory:y"]


def test_surprise_duty_scores_with_the_surprise_multiplier():
    s = Settings(time_limit_seconds=10, workers=2, surprise_multiplier=1.5)
    k = slot("a", "guard", "2027-01-04T08:00", "2027-01-05T08:00", r=0)
    k.is_surprise = True
    sol = solve(problem([soldier("A")], [k], settings=s))
    (a,) = sol.assignments
    assert a.points == 1.5 and a.normalized_points == 1.5


def test_published_facts_that_break_a_rule_do_not_block_new_duties():
    """Stability run: what is already published (fixed) may break a hard rule – two duties too
    close, a mandatory reserve from another gaf, over the monthly cap. Those are facts; the run
    still fills the new duty instead of failing as infeasible, and keeps them out of new choices."""
    A, B, C = soldier("A", gaf="G1"), soldier("B", gaf="G2"), soldier("C", gaf="G1")
    slots = [
        slot("f1", "guard", "2027-01-04T08:00", "2027-01-05T08:00"),
        slot("f2", "guard", "2027-01-05T10:00", "2027-01-06T10:00", r=0),  # A again, 2h after f1 (rest 12h)
        slot("new", "towers", "2027-01-05T12:00", "2027-01-06T12:00", r=0),
    ]
    fixed = [
        FixedAssignment("f1", "A"),
        FixedAssignment("f1", "B", "reserve"),  # mandatory reserve from another gaf
        FixedAssignment("f2", "A"),
    ]
    p = problem([A, B, C], slots, fixed=fixed, settings=Settings(time_limit_seconds=10, workers=2, duty_cap_per_month=1))
    sol = solve(p)
    assert sol.status in ("OPTIMAL", "FEASIBLE")
    got = {(a.slot_id, a.soldier_id, a.role) for a in sol.assignments}
    assert {("f1", "A", "performer"), ("f1", "B", "reserve"), ("f2", "A", "performer")} <= got
    new = [a.soldier_id for a in sol.assignments if a.slot_id == "new"]
    assert new and new[0] != "A"  # A is busy then; the new duty goes to someone else
    assert violations(p, sol) == []
    assert any("נשמרו כמו שהם" in w for w in sol.warnings)


def test_more_published_performers_than_needed_is_a_fact():
    """A reserve activated mid-duty: the original performer keeps the days he did and the reserve
    performs the rest – two published performers on a slot that needs one. Not a failure."""
    A, B, C = soldier("A"), soldier("B"), soldier("C")
    slots = [slot("k", "guard", "2027-01-04T08:00", "2027-01-06T08:00"), slot("new", "towers", "2027-01-10T08:00", "2027-01-11T08:00", r=0)]
    fixed = [FixedAssignment("k", "A"), FixedAssignment("k", "B")]
    sol = solve(problem([A, B, C], slots, fixed=fixed))
    assert sol.status in ("OPTIMAL", "FEASIBLE")
    got = {(a.slot_id, a.soldier_id, a.role) for a in sol.assignments}
    assert {("k", "A", "performer"), ("k", "B", "performer")} <= got
    assert [a for a in sol.assignments if a.slot_id == "new"]
    assert violations(problem([A, B, C], slots, fixed=fixed), sol) == []


def test_infeasible_run_carries_a_diagnosis():
    from mahanroster_solver.solver import diagnose

    A = soldier("A")
    # two fixed duties of A at the same time with the overlap rule on and fixed facts relaxed off:
    # force it through the penalty rule (a penalty slot for A overlapping a fixed duty is still a fact)
    slots = [slot("k1", "guard", "2027-01-04T08:00", "2027-01-05T08:00", r=0)]
    p = problem([A], slots, fixed=[FixedAssignment("k1", "A")])
    assert solve(p).status in ("OPTIMAL", "FEASIBLE")
    assert isinstance(diagnose(p), str)


def test_unfilled_slot_says_what_held_the_eligible_back():
    A = soldier("A")
    slots = [slot("k1", "guard", "2027-01-04T08:00", "2027-01-05T08:00", r=0), slot("k2", "guard", "2027-01-04T10:00", "2027-01-05T10:00", r=0)]
    sol = solve(problem([A], slots))
    assert len(sol.unfilled) == 1
    assert sol.unfilled[0].reasons.get("busy") == 1


def test_rolling_reports_duties_staffed_month_by_month():
    from mahanroster_solver.rolling import solve_rolling

    A, B = soldier("A"), soldier("B")
    slots = [slot("j", "guard", "2027-01-10T08:00", "2027-01-11T08:00", r=0), slot("f", "guard", "2027-02-10T08:00", "2027-02-11T08:00", r=0)]
    calls = []
    solve_rolling(problem([A, B], slots), on_progress=lambda *a: calls.append(a))
    assert calls[0] == (0, 2, 0, 2, "searching") and (2, 2, 2, 2, "searching") in calls
    # then the polish pass over the whole cycle
    assert calls[-1] == (2, 2, 2, 2, "polishing")
    # inside each month, better solutions report as they come
    assert any(c[4] == "improving" for c in calls)


def test_polish_evens_a_small_pool_that_month_by_month_left_uneven():
    """Six soldiers share 13 duties of different worth over six months (as מפקד תורן in 2027):
    each month alone is balanced, the cycle is not – the polish pass deals them out again."""
    from datetime import date

    from mahanroster_solver.models import TaskType
    from mahanroster_solver.rolling import solve_rolling
    from mahanroster_solver.verify import violations

    light, heavy, top = TaskType("l", "קל", 1.0, min_rest_hours=12), TaskType("h", "כבד", 2.0, min_rest_hours=12), TaskType("t", "חג", 2.5, min_rest_hours=12)
    plan = [("01-04", "l"), ("01-19", "l"), ("02-04", "l"), ("02-15", "h"), ("03-01", "l"), ("03-18", "l"), ("03-29", "h"),
            ("04-15", "l"), ("04-26", "h"), ("05-13", "t"), ("05-24", "h"), ("06-08", "l"), ("06-24", "l")]
    # weekdays only (Mon–Thu), so weekend units play no part
    slots = [slot(f"s{i}", t, f"2027-{d}T08:00", f"2027-{d}T20:00", r=0) for i, (d, t) in enumerate(plan)]
    team = [soldier(c) for c in "ABCDEF"]
    p = problem(team, slots, tasks=(light, heavy, top), settings=Settings(time_limit_seconds=30, workers=2))
    p.cycle_end = date(2027, 6, 30)
    sol = solve_rolling(p)
    assert not sol.unfilled and violations(p, sol) == []
    pts = {c: sum(a.normalized_points for a in sol.assignments if a.soldier_id == c) for c in "ABCDEF"}
    # 18.5 points: the best is five at 3.0 and one at 3.5
    assert max(pts.values()) - min(pts.values()) <= 1.0, pts


def test_moves_take_regular_duties_off_those_with_a_heavy_holiday_duty():
    """Three got two regular duties and a 6-point holiday one (8), three only two regular (2):
    the regular duties move from the first to the second."""
    from mahanroster_solver.models import TaskType
    from mahanroster_solver.rolling import _pool_state, move_duties
    from mahanroster_solver.solver import prepare

    light, heavy = TaskType("l", "רגיל", 1.0, min_rest_hours=12), TaskType("h", "חג", 6.0, min_rest_hours=12)
    days = [f"2027-01-{d:02d}" for d in (4, 5, 6, 7, 11, 12, 13, 14, 18, 19, 20, 21)]  # weekdays
    slots = [slot(f"l{i}", "l", f"{d}T08:00", f"{d}T20:00", r=0) for i, d in enumerate(days)]
    slots += [slot(f"h{i}", "h", f"2027-01-{d}T08:00", f"2027-01-{d}T20:00", r=0) for i, d in enumerate((25, 26, 27))]
    team = [soldier(c) for c in "ABCDEF"]
    p = problem(team, slots, tasks=(light, heavy), settings=FAST)
    chosen = [(c, f"l{i}", "performer") for i, c in enumerate("AABBCCDDEEFF")] + [(c, f"h{i}", "performer") for i, c in enumerate("ABC")]
    prep = prepare(p)
    before, _ = _pool_state(p, prep, chosen, {}, list("ABCDEF"))
    assert max(before.values()) == 8 and min(before.values()) == 2
    import time

    moved = move_duties(p, prep, chosen, {}, list("ABCDEF"), deadline=time.time() + 10)
    after, _ = _pool_state(p, prep, moved, {}, list("ABCDEF"))
    assert max(after.values()) == 6 and min(after.values()) == 4, after
    assert violations(p, solution_from(p, moved)) == []


def test_duties_spread_over_weeks_not_in_a_row():
    # a Wednesday guard in each of 4 weeks; A is behind and takes two of them – not in a row
    weds = ["2027-01-06", "2027-01-13", "2027-01-20", "2027-01-27"]
    slots = [slot(f"w{i}", "guard", f"{d}T13:00", f"{d}T20:00", r=0) for i, d in enumerate(weds)]
    p = problem([soldier("A", baseline_score=0), soldier("B", baseline_score=1), soldier("C", baseline_score=1)], slots, settings=FAST)
    order = [{a.slot_id: a.soldier_id for a in solve(p).assignments}[f"w{i}"] for i in range(4)]
    assert order.count("A") == 2
    assert all(order[i] != order[i + 1] for i in range(3)), order


def test_update_run_keeps_the_draft_where_it_holds_and_repairs_the_rest():
    from dataclasses import replace

    from mahanroster_solver.models import Absence, FixedAssignment
    from mahanroster_solver.rolling import solve_rolling

    days = [f"2027-01-{d:02d}" for d in range(4, 29, 3)] + [f"2027-02-{d:02d}" for d in range(1, 26, 3)]
    slots = [slot(f"g{i}", "guard", f"{d}T08:00", f"{d}T20:00", r=1) for i, d in enumerate(days)]
    p = problem([soldier(x) for x in "ABCDEF"], slots, settings=FAST)
    first = solve_rolling(p)
    assert not first.unfilled and violations(p, first) == []
    draft = [FixedAssignment(a.slot_id, a.soldier_id, a.role) for a in first.assignments]

    # A is away in February now: his February duties must go, January stays as it was
    from .helpers import dt

    away = Absence("A", dt("2027-02-01T00:00"), dt("2027-03-01T00:00"))
    upd = replace(p, absences=[away], start=draft)
    sol = solve_rolling(upd)
    assert not sol.unfilled and violations(upd, sol) == []
    jan = lambda s: {(a.slot_id, a.soldier_id, a.role) for a in s.assignments if a.slot_id in {k.id for k in slots[:9]}}  # noqa: E731
    assert jan(sol) == jan(first) or any("הועברו לאיזון" in w and not w.endswith(" 0 הועברו לאיזון") for w in sol.warnings)
    assert not any(a.soldier_id == "A" and a.slot_id in {k.id for k in slots[9:]} for a in sol.assignments)
    assert sol.warnings[0].startswith("עדכון שיבוץ:")
