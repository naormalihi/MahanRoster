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
    # Friday 08:00 – Sunday 08:00: the weight once, by the weekend multiplier
    assert pts(GUARD, "2027-01-08T08:00", "2027-01-10T08:00") == pytest.approx(1.5)


def test_shabbat_type_has_no_weekend_multiplier():
    assert pts(SHABBAT, "2027-01-08T08:00", "2027-01-10T08:00") == pytest.approx(2.5)


def test_weight_is_the_points_of_the_whole_duty():
    # a week (Sunday to Sunday) is worth its weight, once, by the highest multiplier on its days
    assert pts(GUARD, "2027-01-03T08:00", "2027-01-10T08:00") == pytest.approx(1.5)
    assert pts(GUARD, "2027-01-04T08:00", "2027-01-07T08:00") == pytest.approx(1.0)  # Monday to Thursday


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


def test_normalization_by_load_factor_on_the_start_day():
    leader = soldier("A", load_roles=[LoadRolePeriod(0.5, date(2027, 1, 5))])
    # starts Monday (factor 1.0): the factor from Tuesday does not apply
    assert normalized_points(leader, GUARD, dt("2027-01-04T08:00"), dt("2027-01-06T08:00"), S, set()) == pytest.approx(1.0)
    # starts Tuesday (factor 0.5)
    assert normalized_points(leader, GUARD, dt("2027-01-05T08:00"), dt("2027-01-06T08:00"), S, set()) == pytest.approx(2.0)


def test_lowest_factor_wins_with_several_roles():
    s = soldier("A", load_roles=[LoadRolePeriod(0.7, date(2026, 1, 1)), LoadRolePeriod(0.5, date(2026, 1, 1))])
    assert s.factor_on(date(2027, 1, 4)) == 0.5


def test_weekend_units_count():
    assert weekend_units(dt("2027-01-08T08:00"), dt("2027-01-10T08:00"), S, set()) == 1  # one duty, one weekend
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


def test_custom_weekend_times_then_holiday_added():
    # Friday + holiday on the same unit: weight × 1.5 for the weekend, + 2 for the holiday
    assert cpts(GUARD, "2027-01-08T08:00", "2027-01-09T08:00") == pytest.approx(1.5 + 2.0)


def test_custom_night_does_not_stack_on_weekend():
    # Friday night, 20:00–08:00 (12h, mostly night): max(1.5, 1.25) = 1.5
    assert cpts(NIGHT, "2027-01-15T20:00", "2027-01-16T08:00") == pytest.approx(NIGHT.weight * 1.5)


def test_custom_day_type_weekday_and_date_range():
    assert cpts(GUARD, "2027-01-05T08:00", "2027-01-06T08:00") == pytest.approx(1 + 1.8)  # memorial (Tuesday): a day type, added
    assert cpts(GUARD, "2027-01-07T08:00", "2027-01-08T08:00") == pytest.approx(1.3)  # Thursday in January
    assert cpts(GUARD, "2027-02-04T08:00", "2027-02-05T08:00") == pytest.approx(1.0)  # Thursday in February


def test_custom_skip_for_shabbat_types():
    assert cpts(SHABBAT, "2027-01-15T08:00", "2027-01-16T08:00") == pytest.approx(SHABBAT.weight)


def test_custom_window_ignored_for_24h_duties():
    assert cpts(GUARD, "2027-01-11T22:00", "2027-01-12T22:00") == pytest.approx(1.0)


def test_multipliers_by_holiday_and_day_of_it():
    s = Settings(
        multipliers=[
            Multiplier("ערבי חגים מרכזיים", 6.0, holidays=["rosh_hashana", "yom_kippur", "sukkot", "pesach"], holiday_kinds=["eve"]),
            Multiplier("חול המועד", 1.5, holiday_kinds=["chol_hamoed"]),
            Multiplier("חג", 2.0, holiday_kinds=["eve", "day"]),
        ],
        day_holidays={
            "2027-10-15": ["sukkot", "eve"], "2027-10-16": ["sukkot", "day"], "2027-10-18": ["sukkot", "chol_hamoed"],
            "2027-06-10": ["shavuot", "eve"], "2026-12-06": ["hanukkah", "day"],
        },
    )
    one_day = lambda d: raw_points(GUARD, dt(f"{d}T08:00"), dt(f"{d}T20:00"), s, set())  # noqa: E731
    # a holiday adds its value to the weight (1): the highest that applies, once
    assert one_day("2027-10-15") == 7.0    # ערב סוכות: 1 + 6
    assert one_day("2027-10-16") == 3.0    # סוכות itself: only "חג", 1 + 2
    assert one_day("2027-10-18") == 2.5    # חול המועד סוכות, 1 + 1.5
    assert one_day("2027-06-10") == 3.0    # ערב שבועות is not in the first list
    assert one_day("2027-10-20") == 1.0    # an ordinary day
    assert one_day("2026-12-06") == 1.0    # חנוכה: "חג" names no holiday, so the rest days only
    s.multipliers.append(Multiplier("חנוכה", 1.2, holidays=["hanukkah"]))
    assert one_day("2026-12-06") == 2.2    # by name it counts


def test_task_whose_weight_includes_holidays_gets_no_holiday_multiplier():
    from dataclasses import replace

    s = Settings(
        multipliers=[
            Multiplier("סוף שבוע", 3.0, weekdays=[4, 5], skip_shabbat_types=True),
            Multiplier("ערב חג", 6.0, holidays=["yom_kippur"], holiday_kinds=["eve"]),
            Multiplier("חנוכה", 3.0, holidays=["hanukkah"], holiday_kinds=["day"]),
            Multiplier("לפי סוג יום", 2.0, day_types=["holiday"]),
        ],
        day_holidays={"2027-10-10": ["yom_kippur", "eve"], "2027-12-26": ["hanukkah", "day"]},
        day_types={"2027-10-11": "holiday"},
    )
    week = replace(GUARD, includes_holidays=True)
    one_day = lambda t, d: raw_points(t, dt(f"{d}T10:00"), dt(f"{d}T20:00"), s, set())  # noqa: E731
    assert one_day(GUARD, "2027-10-10") == 7.0 and one_day(week, "2027-10-10") == 1.0
    assert one_day(GUARD, "2027-12-26") == 4.0 and one_day(week, "2027-12-26") == 1.0
    assert one_day(GUARD, "2027-10-11") == 3.0 and one_day(week, "2027-10-11") == 1.0
    assert one_day(week, "2027-10-15") == 3.0  # a Friday: the weekend multiplier still applies


def test_special_callup_scores_its_own_points():
    from mahanroster_solver.solver import prepare

    from .helpers import problem, slot, soldier

    k = slot("sp", "guard", "2027-01-08T10:00", "2027-01-09T18:00", r=0, fixed_points=4.0)  # a Friday: no weekend multiplier
    prep = prepare(problem([soldier("A")], [k]))
    assert prep.raw["sp"] == 4.0


def test_holiday_is_added_once_and_a_callup_multiplies_the_sum():
    from dataclasses import replace

    from mahanroster_solver.solver import prepare

    from .helpers import problem, slot, soldier

    s = Settings(
        multipliers=[
            Multiplier("סוף שבוע", 3.0, weekdays=[4, 5], skip_shabbat_types=True),
            Multiplier("ראש השנה · ערב חג", 6.0, holidays=["rosh_hashana"], holiday_kinds=["eve"]),
            Multiplier("פסח · חול המועד", 3.0, holidays=["pesach"], holiday_kinds=["chol_hamoed"]),
        ],
        day_holidays={"2027-09-29": ["rosh_hashana", "eve"], "2027-04-23": ["pesach", "chol_hamoed"], "2027-04-24": ["pesach", "chol_hamoed"]},
        surprise_multiplier=1.3,
    )
    kitchen = replace(GUARD, weight=4.0)
    pts = lambda a, b: raw_points(kitchen, dt(a), dt(b), s, set())  # noqa: E731
    assert pts("2027-09-29T08:00", "2027-09-30T08:00") == pytest.approx(4 + 6)        # ערב ר"ה on a Wednesday: 4 + 6, not 4 × 6
    assert pts("2027-04-23T08:00", "2027-04-24T08:00") == pytest.approx(4 * 3 + 3)    # חול המועד on a Friday: × weekend, + holiday
    assert pts("2027-04-22T08:00", "2027-04-25T08:00") == pytest.approx(4 * 3 + 3)    # three days of it: still once each
    k = slot("k", "guard", "2027-09-29T08:00", "2027-09-30T08:00", is_surprise=True)
    prep = prepare(problem([soldier("A")], [k], tasks=(kitchen,), settings=s))
    assert prep.raw["k"] == pytest.approx((4 + 6) * 1.3)
