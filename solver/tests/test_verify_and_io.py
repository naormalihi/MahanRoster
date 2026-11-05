import pytest

from mahanroster_solver import models, synthetic
from mahanroster_solver.solver import prepare, solution_from
from mahanroster_solver.verify import violations

from .helpers import problem, slot, soldier


def test_json_roundtrip_of_synthetic_problem():
    p = synthetic.generate(months=1, soldiers=40, seed=3)
    again = models.load_problem(models.dumps(p))
    assert models.dumps(again) == models.dumps(p)


def test_unknown_field_is_rejected():
    p = synthetic.generate(months=1, soldiers=5)
    text = models.dumps(p).replace('"cycle_id"', '"cycle_idd"', 1)
    with pytest.raises(ValueError):
        models.load_problem(text)


def _two_slots():
    a = slot("a", "guard", "2027-01-04T08:00", "2027-01-05T08:00")
    b = slot("b", "guard", "2027-01-05T12:00", "2027-01-06T08:00")  # 4h after a – rest is 12h
    return a, b


def test_verifier_catches_missing_rest():
    p = problem([soldier("A"), soldier("B")], _two_slots())
    sol = solution_from(p, [("A", "a", "performer"), ("A", "b", "performer")])
    assert any("מנוחה" in v for v in violations(p, sol))


def test_verifier_counts_reserve_toward_rest():
    p = problem([soldier("A"), soldier("B")], _two_slots())
    sol = solution_from(p, [("B", "a", "performer"), ("A", "a", "reserve"), ("A", "b", "performer")])
    assert any("מנוחה" in v for v in violations(p, sol))


def test_verifier_mandatory_reserve_from_performer_gaf():
    p = problem([soldier("A", "G1"), soldier("B", "G2")], [slot("a", "guard", "2027-01-04T08:00", "2027-01-05T08:00")])
    sol = solution_from(p, [("A", "a", "performer"), ("B", "a", "reserve")])
    assert any("גף" in v for v in violations(p, sol))


def test_clean_schedule_has_no_violations():
    a, b = _two_slots()
    p = problem([soldier("A"), soldier("B"), soldier("C")], [a, b])
    sol = solution_from(p, [("A", "a", "performer"), ("C", "a", "reserve"), ("B", "b", "performer")])
    assert violations(p, sol) == []


def test_explanations_and_pool_stats():
    a, b = _two_slots()
    p = problem([soldier("A", baseline_score=5), soldier("B", baseline_score=9)], [a, b])
    sol = solution_from(p, [("A", "a", "performer"), ("B", "b", "performer")])
    first = sol.assignments[0]
    assert first.soldier_id == "A" and "5.0" in first.explanation and "7.0" in first.explanation
    (pool,) = sol.pools
    assert pool.mean_before == 7.0 and pool.mean_after == 8.0


def test_prepare_on_synthetic_unit_finds_candidates_for_every_slot():
    p = synthetic.generate(months=1, soldiers=240, seed=1)
    prep = prepare(p)
    empty = [k for k, v in prep.eligible.items() if not v]
    assert not empty, empty[:5]
