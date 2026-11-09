from datetime import date

import pytest

from mahanroster_solver.models import LoadRolePeriod, Settings
from mahanroster_solver.scoring import day_units, is_night_duty, normalized_points, raw_points, weekend_units

from .helpers import GUARD, NIGHT, SHABBAT, dt, soldier

S = Settings()


def pts(task, a, b, holidays=()):
    return raw_points(task, dt(a), dt(b), S, set(holidays))


def test_weekday_24h_is_one_unit():
    # 2027-01-04 is a Monday
    assert pts(GUARD, "2027-01-04T08:00", "2027-01-05T08:00") == pytest.approx(1.0)


def test_remainder_is_an_extra_unit():
    assert len(day_units(dt("2027-01-04T08:00"), dt("2027-01-05T09:00"))) == 2


def test_weekend_multiplier_on_regular_type():
    # Friday 08:00 – Sunday 08:00: two units, both start on Fri/Sat
    assert pts(GUARD, "2027-01-08T08:00", "2027-01-10T08:00") == pytest.approx(3.0)


def test_shabbat_type_has_no_weekend_multiplier():
    assert pts(SHABBAT, "2027-01-08T08:00", "2027-01-10T08:00") == pytest.approx(5.0)


def test_week_long_duty_scores_weekend_only_on_weekend_days():
    # Sunday 08:00 to next Sunday 08:00 = 7 units: 5 weekdays + Friday + Saturday
    assert pts(GUARD, "2027-01-03T08:00", "2027-01-10T08:00") == pytest.approx(5 + 2 * 1.5)


def test_holiday_and_weekend_take_the_higher_multiplier():
    friday = date(2027, 1, 8)
    assert pts(GUARD, "2027-01-08T08:00", "2027-01-09T08:00", [friday]) == pytest.approx(2.0)


def test_holiday_multiplier_applies_to_shabbat_type():
    friday = date(2027, 1, 8)
    assert pts(SHABBAT, "2027-01-08T08:00", "2027-01-09T08:00", [friday]) == pytest.approx(5.0)


def test_night_multiplier_only_for_short_mostly_night_duties():
    assert is_night_duty(dt("2027-01-04T20:00"), dt("2027-01-05T08:00"), S)
    assert not is_night_duty(dt("2027-01-04T08:30"), dt("2027-01-04T17:30"), S)
    assert not is_night_duty(dt("2027-01-04T20:00"), dt("2027-01-05T20:00"), S)
    assert pts(NIGHT, "2027-01-04T20:00", "2027-01-05T08:00") == pytest.approx(1.25)


def test_normalization_by_load_factor_per_unit_day():
    leader = soldier("A", load_roles=[LoadRolePeriod(0.5, date(2027, 1, 5))])
    # Monday unit at factor 1.0, Tuesday unit at factor 0.5
    got = normalized_points(leader, GUARD, dt("2027-01-04T08:00"), dt("2027-01-06T08:00"), S, set())
    assert got == pytest.approx(1.0 + 2.0)


def test_lowest_factor_wins_with_several_roles():
    s = soldier("A", load_roles=[LoadRolePeriod(0.7, date(2026, 1, 1)), LoadRolePeriod(0.5, date(2026, 1, 1))])
    assert s.factor_on(date(2027, 1, 4)) == 0.5


def test_weekend_units_count():
    assert weekend_units(dt("2027-01-08T08:00"), dt("2027-01-10T08:00"), S, set()) == 2
    assert weekend_units(dt("2027-01-04T08:00"), dt("2027-01-05T08:00"), S, set()) == 0


# --- user-defined multipliers -------------------------------------------------

from mahanroster_solver.models import Multiplier  # noqa: E402

CUSTOM = Settings(
    multipliers=[
        Multiplier("סוף שבוע", 1.5, weekdays=[4, 5], skip_shabbat_types=True),
        Multiplier("חג", 2.0, day_types=["holiday", "holiday_eve"]),
        Multiplier("לילה", 1.25, time_window="22:00-06:00"),
        Multiplier("יום זיכרון", 1.8, day_types=["memorial"]),
        Multiplier("חמישי בכוננות", 1.3, weekdays=[3], date_from=date(2027, 1, 1), date_to=date(2027, 1, 31)),
    ],
    day_types={"2027-01-05": "memorial", "2027-01-08": "holiday"},
)


def cpts(task, a, b):
    return raw_points(task, dt(a), dt(b), CUSTOM, set())


def test_custom_highest_multiplier_wins():
    # Friday + holiday on the same unit: 2.0, not 1.5 and not the product
    assert cpts(GUARD, "2027-01-08T08:00", "2027-01-09T08:00") == pytest.approx(2.0)


def test_custom_night_does_not_stack_on_weekend():
    # Friday night, 20:00–08:00 (12h, mostly night): max(1.5, 1.25) = 1.5
    assert cpts(NIGHT, "2027-01-15T20:00", "2027-01-16T08:00") == pytest.approx(NIGHT.weight * 1.5)


def test_custom_day_type_weekday_and_date_range():
    assert cpts(GUARD, "2027-01-05T08:00", "2027-01-06T08:00") == pytest.approx(1.8)  # memorial (Tuesday)
    assert cpts(GUARD, "2027-01-07T08:00", "2027-01-08T08:00") == pytest.approx(1.3)  # Thursday in January
    assert cpts(GUARD, "2027-02-04T08:00", "2027-02-05T08:00") == pytest.approx(1.0)  # Thursday in February


def test_custom_skip_for_shabbat_types():
    assert cpts(SHABBAT, "2027-01-15T08:00", "2027-01-16T08:00") == pytest.approx(SHABBAT.weight)


def test_custom_window_ignored_for_24h_duties():
    assert cpts(GUARD, "2027-01-11T22:00", "2027-01-12T22:00") == pytest.approx(1.0)
