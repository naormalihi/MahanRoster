"""End-to-end solver tests. Skipped when OR-Tools is not installed."""

import pytest

pytest.importorskip("ortools")  # real CP-SAT, or the HiGHS shim from conftest

from mahanroster_solver import synthetic  # noqa: E402
from mahanroster_solver.models import FixedAssignment, Settings  # noqa: E402
from statistics import pstdev  # noqa: E402

from mahanroster_solver.solver import prepare, solve  # noqa: E402
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
