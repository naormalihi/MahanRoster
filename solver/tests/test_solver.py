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
