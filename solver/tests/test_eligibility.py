from datetime import date

from mahanroster_solver.eligibility import EligibilityIndex
from mahanroster_solver.models import Absence, DateBlock, Exemption, PersonalConstraint, TaskType

from .helpers import DAYDUTY, GUARD, dt, problem, slot, soldier

MON = ("2027-01-04T08:00", "2027-01-05T08:00")


def reasons(s, k, **kw):
    p = problem([s], [k], **kw)
    return EligibilityIndex(p).check(s, k)


def test_eligible_by_default():
    assert reasons(soldier("A"), slot("k", "guard", *MON)) == []


def test_service_restriction():
    assert "service" in reasons(soldier("A", service_type="career", populations=["career"]), slot("k", "guard", *MON))


def test_population_rank_gender():
    officer_only = TaskType("ko", "קצין תורן", 1.0, eligible_populations=["officer"], rank_max=11, gender="male")
    tasks = (officer_only,)
    k = slot("k", "ko", *MON)
    assert "population" in reasons(soldier("A"), k, tasks=tasks)
    major = soldier("B", service_type="career", populations=["career", "officer"], rank_order=12)
    assert "rank" in reasons(major, k, tasks=tasks)
    woman = soldier("C", service_type="career", populations=["officer"], rank_order=10, gender="female")
    assert "gender" in reasons(woman, k, tasks=tasks)


def test_slot_rank_override():
    k = slot("k", "guard", *MON, rank_min=3)
    assert "rank" in reasons(soldier("A", rank_order=2), k)


def test_qualifying_duty_only_for_qualifying_soldiers():
    parent = soldier("P", qualifies_day_only=True)
    assert "qualifying_only" in reasons(parent, slot("k", "guard", *MON))
    assert reasons(parent, slot("d", "day", "2027-01-04T08:30", "2027-01-04T16:30", r=0)) == []
    assert "not_qualifying" in reasons(soldier("A"), slot("d", "day", "2027-01-04T08:30", "2027-01-04T16:30", r=0))


def test_shachar_mandatory_only_compatible_types():
    s = soldier("A", is_shachar=True)
    assert "shachar" in reasons(s, slot("k", "guard", *MON))


def test_weapon_range_must_be_valid_through_last_day():
    s = soldier("A", range_valid_until=date(2027, 1, 4))
    assert "weapon_range" in reasons(s, slot("k", "guard", "2027-01-04T08:00", "2027-01-05T09:00"))
    # ends exactly at midnight of the 5th -> last day is the 4th
    assert reasons(s, slot("k", "guard", "2027-01-04T08:00", "2027-01-05T00:00")) == []


def test_service_dates_and_grace():
    assert "released" in reasons(soldier("A", release_date=date(2027, 1, 4)), slot("k", "guard", *MON))
    assert "not_enlisted" in reasons(soldier("A", enlistment_date=date(2027, 1, 5)), slot("k", "guard", *MON))
    assert "grace" in reasons(soldier("A", unit_join_date=date(2026, 12, 20)), slot("k", "guard", *MON))
    assert reasons(soldier("A", unit_join_date=date(2026, 12, 1)), slot("k", "guard", *MON)) == []


def test_full_and_partial_exemptions():
    s = soldier("A")
    k = slot("k", "guard", *MON)
    full = [Exemption("A", date(2027, 1, 1), date(2027, 1, 4))]
    assert "exemption" in reasons(s, k, exemptions=full)
    other_type = [Exemption("A", date(2027, 1, 1), date(2027, 2, 1), excluded_task_type_ids=["towers"])]
    assert reasons(s, k, exemptions=other_type) == []
    by_hours = [Exemption("A", date(2027, 1, 1), date(2027, 2, 1), restricted_hours="22:00-06:00")]
    assert "exemption" in reasons(s, k, exemptions=by_hours)
    day_slot = slot("d", "guard", "2027-01-04T08:00", "2027-01-04T16:00")
    assert reasons(s, day_slot, exemptions=by_hours) == []


def test_absence_block_and_personal_constraint():
    s = soldier("A")
    k = slot("k", "guard", *MON)
    assert "absence" in reasons(s, k, absences=[Absence("A", dt("2027-01-05T07:00"), dt("2027-01-06T07:00"))])
    assert reasons(s, k, absences=[Absence("A", dt("2027-01-05T08:00"), dt("2027-01-06T07:00"))]) == []
    assert "date_block" in reasons(s, k, date_blocks=[DateBlock("A", date(2027, 1, 5))])
    dark = [PersonalConstraint("A", "guard", "18:00-06:00")]
    assert "personal_constraint" in reasons(s, k, personal_constraints=dark)
    expired = [PersonalConstraint("A", "guard", None, valid_until=date(2027, 1, 1))]
    assert reasons(s, k, personal_constraints=expired) == []


def test_penalty_slot_only_for_named_soldier():
    k = slot("p", "guard", *MON, r=0, is_penalty=True, penalty_soldier_id="B")
    assert reasons(soldier("A"), k) == ["penalty_other"]
    assert reasons(soldier("B", service_type="career"), k) == []


def test_qualifying_duty_also_open_to_listed_population_within_rank_range():
    day = TaskType("day", "ממלכ\"ת יום", 0.75, qualifying_duty=True, eligible_populations=["major"], rank_max=13)
    k = slot("d", "day", "2027-01-04T08:00", "2027-01-04T17:00", r=0)
    major = soldier("M", service_type="career", populations=["career", "officer", "major"], rank_order=13)
    colonel = soldier("C", service_type="career", populations=["career", "officer", "major"], rank_order=14)
    captain = soldier("K", service_type="career", populations=["career", "officer"], rank_order=12)
    parent = soldier("P", service_type="career", populations=["career"], rank_order=6, qualifies_day_only=True)
    assert reasons(major, k, tasks=(day,)) == []
    assert "rank" in reasons(colonel, k, tasks=(day,))
    assert "not_qualifying" in reasons(captain, k, tasks=(day,))
    assert reasons(parent, k, tasks=(day,)) == []
