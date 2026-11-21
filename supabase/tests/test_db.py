"""Database tests: migrations, RLS per role, audit log, and a full round trip
through the scheduling engine (snapshot → input → solve → apply → publish → board).

Needs a PostgreSQL server (16+) reachable through DATABASE_URL, default
postgresql://postgres:postgres@localhost:5432/postgres. A throwaway database
`mahanroster_test` is created from scratch for the session.
"""

from __future__ import annotations

from decimal import Decimal
import pathlib
import hashlib
import json
from datetime import date, timedelta
import os
import sys
import uuid
from contextlib import contextmanager
from pathlib import Path

import psycopg
import pytest
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))

from mahanroster_solver import models, synthetic  # noqa: E402
from mahanroster_solver.rolling import solve_rolling  # noqa: E402
from mahanroster_solver.verify import violations  # noqa: E402

ADMIN_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/postgres")
DB = "mahanroster_test"

COORD, DEPUTY_ACTIVE, DEPUTY_EXPIRED, VIEWER, OUTSIDER = (uuid.uuid4() for _ in range(5))


def _db_url(name: str) -> str:
    base, _, _ = ADMIN_URL.rpartition("/")
    return f"{base}/{name}"


@pytest.fixture(scope="session")
def conn():
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute(f"drop database if exists {DB} with (force)")
        admin.execute(f"create database {DB}")
    c = psycopg.connect(_db_url(DB), autocommit=True)
    files = [ROOT / "supabase/tests/supabase_stub.sql"] + sorted((ROOT / "supabase/migrations").glob("*.sql"))
    for f in files:
        c.execute(f.read_text(encoding="utf-8"))
    seed(c)
    yield c
    c.close()


def _claims(c, user_id, aal="aal2"):
    c.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(user_id),))
    c.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({"sub": str(user_id), "aal": aal}),))


@contextmanager
def session_as(c, user_id, role="authenticated", aal="aal2"):
    """Run statements as a Supabase API role with a given JWT subject, then roll back."""
    with c.transaction():
        c.execute(f"set local role {role}")
        if user_id:
            _claims(c, user_id, aal)
        yield c
        raise psycopg.Rollback()


# ---------------------------------------------------------------------------
# Seed: reference data, a fictitious unit (from the solver's generator), users
# ---------------------------------------------------------------------------

RANK_TAGS = {
    "טוראי": [], "רב\"ט": [], "סמל": [], "סמ\"ר": [], "רס\"ל": [], "רס\"ר": [], "רס\"מ": [], "רס\"ב": [], "רנ\"ג": [],
    "סגן": ["officer"], "סרן": ["officer"], "רס\"ן": ["officer", "major"], "סא\"ל": ["officer", "major"],
}


def seed(c):
    p = synthetic.generate(months=1, soldiers=120, gafim=4, seed=7)
    q = c.execute
    # the tests use the solver's fictitious catalog instead of the shipped reference data
    q("truncate populations, day_types, ranks, load_roles, absence_types, exemption_types cascade")
    q("insert into populations (code, name) values ('mandatory','חובה'),('career','קבע'),('officer','קצינים'),('major','רס\"ן ומעלה')")
    q("insert into day_types (code, name) values ('weekday','חול'),('weekend','סופ\"ש'),('holiday','חג'),('holiday_eve','ערב חג'),('memorial','יום זיכרון')")
    q("update day_types set counts_as_holiday = true where code in ('holiday', 'holiday_eve')")
    q("insert into day_types (code, name, counts_as_holiday) values ('major_holiday','חג מרכזי',true),('major_holiday_eve','ערב חג מרכזי',true),('chol_hamoed','חול המועד',false),('observance','מועד (לא שבתון)',false)")
    rank_id = {}
    for name, order in synthetic.RANKS.items():
        rank_id[order] = q(
            "insert into ranks (name, sort_order, population_tags) values (%s,%s,%s) returning id",
            (name, order, RANK_TAGS[name]),
        ).fetchone()[0]
    unit = q("insert into org_units (kind, name) values ('unit','יחידה') returning id").fetchone()[0]
    gaf_id = {}
    for g in sorted({s.gaf_id for s in p.soldiers}):
        gaf_id[g] = q("insert into org_units (parent_id, kind, name) values (%s,'gaf',%s) returning id", (unit, g)).fetchone()[0]
    task_id = {}
    for t in p.task_types:
        task_id[t.id] = q(
            """insert into task_types (code, name, weight, min_rest_hours, service_restriction, requires_weapon,
                 is_weekend_type, shachar_compatible, qualifying_duty, eligible_populations, rank_min_id, rank_max_id)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning id""",
            (t.id, t.name, t.weight, t.min_rest_hours, t.service_restriction, t.requires_weapon, t.is_weekend_type,
             t.shachar_compatible, t.qualifying_duty, t.eligible_populations,
             rank_id.get(t.rank_min), rank_id.get(t.rank_max)),
        ).fetchone()[0]
    team_leader = q("insert into load_roles (name, factor) values ('ראש צוות', 0.5) returning id").fetchone()[0]
    oncall = q("insert into load_roles (name, factor) values ('כונן', 0.7) returning id").fetchone()[0]
    general = q("insert into exemption_types (name) values ('פטור כללי') returning id").fetchone()[0]
    qualifying = q("insert into exemption_types (name, qualifies_day_only) values ('פטור מזכה', true) returning id").fetchone()[0]
    vacation = q("insert into absence_types (name) values ('חופשה') returning id").fetchone()[0]

    soldier_id = {}
    for s in p.soldiers:
        key = hashlib.sha256(s.id.encode()).hexdigest()  # stands in for the HMAC of a personal number
        soldier_id[s.id] = q(
            """insert into soldiers (soldier_key, full_name, service_type, gender, gaf_id, enlistment_date, release_date,
                 unit_join_date, computed_rank_id, range_valid_until, is_shachar, parent_status, opening_score, opening_score_at)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now() - interval '1 day') returning id""",
            (key, f"חייל {s.id[1:]}", s.service_type, s.gender, gaf_id[s.gaf_id], s.enlistment_date, s.release_date,
             s.unit_join_date, rank_id[s.rank_order], s.range_valid_until, s.is_shachar, s.qualifies_day_only,
             s.baseline_score),
        ).fetchone()[0]
        for lr in s.load_roles:
            q("insert into soldier_load_roles values (%s,%s,%s,%s)",
              (soldier_id[s.id], team_leader if lr.factor == 0.5 else oncall, lr.valid_from, lr.valid_to))

    cycle = q("insert into cycles (name, start_date, end_date, status) values ('מחזור בדיקה', %s, %s, 'slots') returning id",
              (p.cycle_start, p.cycle_end)).fetchone()[0]
    for k in p.slots:
        q("""insert into slots (cycle_id, task_type_id, starts_at, ends_at, performers_needed, reserves_needed)
             values (%s,%s,(%s::timestamp at time zone 'Asia/Jerusalem'),(%s::timestamp at time zone 'Asia/Jerusalem'),%s,%s)""",
          (cycle, task_id[k.task_type_id], k.starts_at, k.ends_at, k.performers_needed, k.reserves_needed))
    for e in p.exemptions:
        excluded = [task_id[t] for t in e.excluded_task_type_ids] if e.excluded_task_type_ids else None
        q("""insert into exemptions (soldier_id, exemption_type_id, kind, start_date, end_date, excluded_task_type_ids,
               status, proof_checked_at, received_via, received_at)
             values (%s,%s,%s,%s,%s,%s,'approved',now(),'in_person',now())""",
          (soldier_id[e.soldier_id], general, "partial" if excluded else "full", e.start_date, e.end_date, excluded))
    for a in p.absences:
        q("""insert into absences (soldier_id, absence_type_id, starts_at, ends_at, received_via, received_at)
             values (%s,%s,(%s::timestamp at time zone 'Asia/Jerusalem'),(%s::timestamp at time zone 'Asia/Jerusalem'),'message',now())""",
          (soldier_id[a.soldier_id], vacation, a.starts_at, a.ends_at))
    for b in p.date_blocks:
        q("insert into date_blocks (soldier_id, cycle_id, day, received_via) values (%s,%s,%s,'excel') on conflict do nothing",
          (soldier_id[b.soldier_id], cycle, b.date))

    users = [(COORD, "naat"), (DEPUTY_ACTIVE, "deputy"), (DEPUTY_EXPIRED, "old.deputy"), (VIEWER, "board"), (OUTSIDER, "nobody")]
    for uid, name in users:
        q("insert into auth.users (id, email) values (%s, %s)", (uid, f"{name}@users.invalid"))
        q("insert into app_users (id, username) values (%s, %s)", (uid, name))
    q("insert into user_roles (user_id, role) values (%s,'coordinator')", (COORD,))
    q("insert into user_roles (user_id, role, valid_from, valid_to) values (%s,'deputy', now() - interval '1 day', now() + interval '7 days')", (DEPUTY_ACTIVE,))
    q("insert into user_roles (user_id, role, valid_from, valid_to) values (%s,'deputy', now() - interval '30 days', now() - interval '1 day')", (DEPUTY_EXPIRED,))
    q("insert into user_roles (user_id, role) values (%s,'viewer')", (VIEWER,))
    c.cycle_id = cycle
    c.qualifying_type = qualifying


def count(cur, sql, *args):
    return cur.execute(sql, args).fetchone()[0]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_seed_loaded(conn):
    assert count(conn, "select count(*) from soldiers") == 120
    assert count(conn, "select count(*) from slots") > 150


@pytest.mark.parametrize("table", ["soldiers", "exemptions", "assignments", "slots", "settings", "absences"])
def test_staff_see_everything_others_see_nothing(conn, table):
    total = count(conn, f"select count(*) from {table}")
    with session_as(conn, COORD) as cur:
        assert count(cur, f"select count(*) from {table}") == total
    with session_as(conn, DEPUTY_ACTIVE) as cur:
        assert count(cur, f"select count(*) from {table}") == total
    for user in (DEPUTY_EXPIRED, VIEWER, OUTSIDER):
        with session_as(conn, user) as cur:
            assert count(cur, f"select count(*) from {table}") == 0, user


def test_staff_rights_need_a_second_factor(conn):
    with session_as(conn, COORD, aal="aal1") as cur:
        assert count(cur, "select count(*) from soldiers") == 0
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute("select public.request_schedule(%s)", (conn.cycle_id,))
    with session_as(conn, COORD, aal="aal2") as cur:
        assert count(cur, "select count(*) from soldiers") == 120


def test_anon_has_no_table_access(conn):
    with session_as(conn, None, role="anon") as cur:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute("select count(*) from soldiers")


def test_viewer_cannot_write(conn):
    with session_as(conn, VIEWER) as cur:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute("update soldiers set full_name = 'x'")  # RLS hides rows; with check blocks inserts
            cur.execute("insert into settings (key, value) values ('x', '1')")


def test_deputy_cannot_grant_roles(conn):
    with session_as(conn, DEPUTY_ACTIVE) as cur:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute("insert into user_roles (user_id, role) values (%s, 'coordinator')", (DEPUTY_ACTIVE,))


def test_user_sees_only_own_account(conn):
    with session_as(conn, VIEWER) as cur:
        rows = cur.execute("select username from app_users").fetchall()
        assert rows == [("board",)]


def test_audit_log_records_and_is_append_only(conn):
    with session_as(conn, COORD) as cur:
        sid = cur.execute("select id from soldiers limit 1").fetchone()[0]
        cur.execute("update soldiers set range_valid_until = range_valid_until + 1 where id = %s", (sid,))
        row = cur.execute(
            "select actor_user_id, action from audit_log where entity_type = 'soldiers' and entity_id = %s order by id desc limit 1",
            (str(sid),),
        ).fetchone()
        assert row == (COORD, "update")
    with pytest.raises(psycopg.errors.RaiseException):
        conn.execute("update audit_log set action = 'x' where id = (select min(id) from audit_log)")


def test_approved_exemption_needs_proof_mark(conn):
    with pytest.raises(psycopg.errors.CheckViolation):
        conn.execute(
            """insert into exemptions (soldier_id, exemption_type_id, kind, start_date, end_date, status)
               select id, (select id from exemption_types limit 1), 'full', current_date, current_date, 'approved'
               from soldiers limit 1"""
        )


def test_soldier_key_must_be_an_hmac_not_a_personal_number(conn):
    with pytest.raises(psycopg.errors.CheckViolation):
        conn.execute(
            "insert into soldiers (soldier_key, full_name, service_type, gaf_id) values ('1234567', 'x', 'mandatory', (select id from org_units where kind='gaf' limit 1))"
        )


def test_round_trip_through_the_engine(conn):
    cycle = conn.cycle_id
    with session_as(conn, VIEWER) as cur:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute("select public.request_schedule(%s)", (cycle,))

    # 1. snapshot + input, as נע"ת
    conn.execute("begin")
    conn.execute("set local role authenticated")
    _claims(conn, COORD)
    job = conn.execute("select public.request_schedule(%s)", (cycle,)).fetchone()[0]
    payload = conn.execute("select input from schedule_jobs where id = %s", (job,)).fetchone()[0]
    conn.execute("commit")

    problem = models.load_problem(json.dumps(payload))
    assert len(problem.soldiers) > 100 and len(problem.slots) > 150
    assert problem.settings.weekend_weekdays == [4, 5]
    assert all(not s.id.isdigit() for s in problem.soldiers)  # opaque ids only

    # 2. solve (what the Cloud Run worker does)
    problem.settings.time_limit_seconds = 30
    problem.settings.workers = 2
    solution = solve_rolling(problem)
    assert solution.status in ("OPTIMAL", "FEASIBLE")
    assert violations(problem, solution) == []

    # 3. apply as the worker (service role) and publish as נע"ת
    conn.execute("begin")
    conn.execute("set local role service_role")
    applied = conn.execute(
        "select public.apply_solver_result(%s, %s)", (job, Jsonb(models._to_jsonable(solution)))
    ).fetchone()[0]
    conn.execute("commit")
    assert applied == len(solution.assignments)
    reserves_unpaired = count(
        conn,
        "select count(*) from assignments a join slots s on s.id = a.slot_id where s.cycle_id = %s and a.role = 'reserve' and a.paired_assignment_id is null",
        cycle,
    )
    assert reserves_unpaired == 0

    with session_as(conn, VIEWER) as cur:
        assert count(cur, "select count(*) from published_board") == 0  # not published yet

    conn.execute("begin")
    conn.execute("set local role authenticated")
    _claims(conn, COORD)
    conn.execute("select public.publish_cycle(%s)", (cycle,))
    conn.execute("commit")

    # 4. the shared view account sees the board – and only names, no scores
    with session_as(conn, VIEWER) as cur:
        result = cur.execute("select * from published_board order by starts_at")
        cols = [d.name for d in result.description]
        rows = result.fetchall()
        assert len(rows) == len(problem.slots)
        assert not {"explanation", "points", "normalized_points", "soldier_key"} & set(cols)
        assert sum(len(r[cols.index("performers")]) for r in rows) == sum(
            1 for a in solution.assignments if a.role == "performer"
        )
    with session_as(conn, OUTSIDER) as cur:
        assert count(cur, "select count(*) from published_board") == 0


def test_snapshot_uses_appointment_rank_and_qualifying_exemption(conn):
    cycle = conn.cycle_id
    sid, _ = conn.execute(
        "select id, computed_rank_id from soldiers where service_type = 'career' and not parent_status order by id limit 1"
    ).fetchone()
    major = conn.execute("select id from ranks where sort_order = 12").fetchone()[0]
    conn.execute("update soldiers set appointment_rank_id = %s where id = %s", (major, sid))
    conn.execute(
        """insert into exemptions (soldier_id, exemption_type_id, kind, start_date, end_date, status, proof_checked_at)
           select %s, %s, 'partial', start_date, end_date, 'approved', now() from cycles where id = %s""",
        (sid, conn.qualifying_type, cycle),
    )
    conn.execute("select public.snapshot_cycle(%s)", (cycle,))
    row = conn.execute(
        "select rank_order, populations, qualifies_day_only from cycle_soldier_snapshot where cycle_id = %s and soldier_id = %s",
        (cycle, sid),
    ).fetchone()
    assert row[0] == 12 and "major" in row[1] and row[2] is True


def test_worker_processes_a_queued_job(conn):
    """The Cloud Run worker: claim → solve → verify → apply, through a direct DB connection."""
    from mahanroster_solver import worker

    cycle = conn.cycle_id
    conn.execute("update settings set value = '20' where key = 'solver_time_limit_seconds'")
    job = conn.execute("select public.request_schedule(%s, 'stability')", (cycle,)).fetchone()[0]
    claimed = worker.claim(conn)
    assert claimed[0] == job
    status = worker.run_one(conn, *claimed)
    assert status in ("OPTIMAL", "FEASIBLE")
    row = conn.execute("select status, progress from schedule_jobs where id = %s", (job,)).fetchone()
    assert row == ("done", 100)
    # stability mode kept every published assignment
    assert count(conn, "select count(*) from assignments a join slots s on s.id = a.slot_id where s.cycle_id = %s and a.status = 'draft'", cycle) == 0


def test_missing_range_date_is_assumed_valid(conn):
    sid = conn.execute("select id from soldiers where range_valid_until is not null order by id limit 1").fetchone()[0]
    conn.execute("update soldiers set range_valid_until = null where id = %s", (sid,))
    end = conn.execute("select end_date from cycles where id = %s", (conn.cycle_id,)).fetchone()[0]

    def range_in_input():
        doc = conn.execute("select public.build_solver_input(%s)", (conn.cycle_id,)).fetchone()[0]
        return next(s["range_valid_until"] for s in doc["soldiers"] if s["id"] == str(sid))

    assert range_in_input() >= end.isoformat()
    conn.execute("update settings set value = 'false' where key = 'assume_range_valid'")
    assert range_in_input() is None
    conn.execute("update settings set value = 'true' where key = 'assume_range_valid'")


def test_service_type_follows_career_start_date_per_cycle(conn):
    cycle = conn.cycle_id
    start = conn.execute("select start_date from cycles where id = %s", (cycle,)).fetchone()[0]
    future, past = conn.execute(
        "select (array_agg(id order by id))[1], (array_agg(id order by id))[2] from soldiers where service_type = 'mandatory' and is_active"
    ).fetchone()
    conn.execute("update soldiers set career_start_date = %s where id = %s", (start.replace(year=start.year + 1), future))
    conn.execute("update soldiers set career_start_date = %s where id = %s", (start.replace(year=start.year - 1), past))
    conn.execute("select public.snapshot_cycle(%s)", (cycle,))
    rows = dict(conn.execute(
        "select soldier_id, service_type::text from cycle_soldier_snapshot where cycle_id = %s and soldier_id in (%s, %s)",
        (cycle, future, past),
    ).fetchall())
    assert rows == {future: "mandatory", past: "career"}
    doc = conn.execute("select public.build_solver_input(%s)", (cycle,)).fetchone()[0]
    by_id = {s["id"]: s for s in doc["soldiers"]}
    assert by_id[str(past)]["service_type"] == "career" and by_id[str(past)]["balance_population"] == "career"


def test_weight_changes_are_recorded(conn):
    tid = conn.execute("select id from task_types order by code limit 1").fetchone()[0]
    count = lambda: conn.execute("select count(*) from weight_history where task_type_id = %s", (tid,)).fetchone()[0]
    before = count()
    with session_as(conn, COORD):
        conn.execute("update task_types set weight = weight + 0.25 where id = %s", (tid,))
        conn.execute("update task_types set name = name where id = %s", (tid,))  # not a weight change
        assert count() == before + 1
        by = conn.execute(
            "select changed_by from weight_history where task_type_id = %s order by id desc limit 1", (tid,)
        ).fetchone()[0]
        assert by == COORD
        mid = conn.execute("update score_multipliers set value = 2.5 where name = 'חג וערב חג' returning id").fetchone()[0]
        v = conn.execute(
            "select value from weight_history where multiplier_key = %s order by id desc limit 1", (str(mid),)
        ).fetchone()[0]
        assert float(v) == 2.5


def test_score_multipliers_highest_applies(conn):
    um = lambda day, shabbat, a, b: float(conn.execute(
        "select app.unit_multiplier(%s::date, %s, %s::timestamp, %s::timestamp)", (day, shabbat, a, b)).fetchone()[0])
    # the three fixed ones were moved over from the settings
    assert {r[0] for r in conn.execute("select name from score_multipliers")} >= {"סוף שבוע", "חג וערב חג", "לילה"}
    assert conn.execute("select count(*) from settings where key in ('weekend_multiplier', 'holiday_multiplier', 'night_multiplier')").fetchone()[0] == 0
    with conn.transaction():
        conn.execute("insert into calendar_days (day, day_type) values ('2031-01-07', 'memorial') on conflict (day) do update set day_type = 'memorial'")
        conn.execute("insert into score_multipliers (name, value, day_types) values ('יום זיכרון', 1.8, '{memorial}')")
        conn.execute("insert into score_multipliers (name, value, weekdays, date_from, date_to) values ('חמישי בינואר', 1.3, '{4}', '2031-01-01', '2031-01-31')")
        assert um("2031-01-07", False, "2031-01-07 08:00", "2031-01-08 08:00") == 1.8      # memorial, a Tuesday
        assert um("2031-01-09", False, "2031-01-09 08:00", "2031-01-10 08:00") == 1.3      # Thursday in January
        assert um("2031-02-06", False, "2031-02-06 08:00", "2031-02-07 08:00") == 1.0      # Thursday in February
        assert um("2031-01-10", True, "2031-01-10 08:00", "2031-01-11 08:00") == 1.0       # Shabbat type on Friday
        # Friday night: weekend 1.5 and night 1.25 – the highest, not the product
        assert um("2031-01-17", False, "2031-01-17 20:00", "2031-01-18 08:00") == 1.5
        assert um("2031-01-14", False, "2031-01-14 20:00", "2031-01-15 08:00") == 1.25     # weekday night
        with pytest.raises(psycopg.Error):  # a multiplier without a condition
            conn.execute("insert into score_multipliers (name, value) values ('תמיד', 2)")
        raise psycopg.Rollback()


def test_staff_manage_the_calendar_and_viewer_cannot(conn):
    with session_as(conn, COORD):
        conn.execute("insert into calendar_days (day, day_type, source, note) values ('2030-04-18','holiday','hebcal','פסח')")
        assert conn.execute("select count(*) from calendar_days where day = '2030-04-18'").fetchone()[0] == 1
    with session_as(conn, VIEWER):
        with pytest.raises(psycopg.Error):
            conn.execute("insert into calendar_days (day, day_type) values ('2030-04-19','holiday')")


def test_holidays_are_preloaded(conn):
    # the test seed truncates reference data (and the calendar with it), so apply the file again
    conn.execute((ROOT / "supabase/migrations/20261107000011_holidays_2026_2035.sql").read_text(encoding="utf-8"))
    rows = dict(conn.execute(
        "select day::text, day_type from calendar_days where day in ('2026-09-21', '2027-04-22', '2035-10-03')"
    ).fetchall())
    assert rows.get("2026-09-21") == "holiday"  # יום כיפור
    assert rows.get("2027-04-22") == "holiday"  # פסח
    assert conn.execute("select count(*) from calendar_days where extract(year from day) = 2035").fetchone()[0] >= 15


STATIC_REASONS = {"service", "population", "rank", "gender", "qualifying_only", "not_qualifying", "shachar", "shachar_only", "home_nightly", "tash_closed"}


def _as_coord(conn, sql, *args):
    conn.execute("begin")
    conn.execute("set local role authenticated")
    _claims(conn, COORD)
    try:
        return conn.execute(sql, args).fetchall()
    finally:
        conn.execute("commit")


def test_potential_matches_the_engine_eligibility(conn):
    from datetime import datetime, timedelta

    from mahanroster_solver.eligibility import EligibilityIndex

    cycle = conn.cycle_id
    # one category per duty type, so a category cell = that duty
    for (tid, code) in conn.execute("select id, code from task_types where category_id is null").fetchall():
        cat = conn.execute("insert into duty_categories (name) values (%s) returning id", (f"קט {code}",)).fetchone()[0]
        conn.execute("update task_types set category_id = %s where id = %s", (cat, tid))
    # a few ת"ש 7 soldiers: one from the file, one by manual override, one override that expired
    a, b, c = [r[0] for r in conn.execute("select id from soldiers where is_active order by id limit 3").fetchall()]
    conn.execute("update soldiers set home_nightly = true where id = %s", (a,))
    conn.execute("update soldiers set home_nightly_override = true, home_nightly_override_reason = 'x' where id = %s", (b,))
    conn.execute(
        "update soldiers set home_nightly = true, home_nightly_override = false, home_nightly_override_reason = 'x', "
        "home_nightly_override_until = '2000-01-01' where id = %s", (c,))
    _as_coord(conn, "select public.compute_potential(%s)", cycle)
    assert conn.execute("select potential_computed_at is not null from cycles where id = %s", (cycle,)).fetchone()[0]

    sql_static = {
        (str(s), str(t)): set(r)
        for s, t, r in conn.execute("select soldier_id, task_type_id, reasons from app.potential_static(%s)", (cycle,)).fetchall()
    }
    doc = conn.execute("select public.build_solver_input(%s)", (cycle,)).fetchone()[0]
    problem = models.load_problem(json.dumps(doc))
    home = {x.id for x in problem.soldiers if x.home_nightly}
    assert home == {str(a), str(b), str(c)}
    idx = EligibilityIndex(problem)
    mid = datetime.combine(problem.cycle_start + timedelta(days=40), datetime.min.time()).replace(hour=8)
    compared = 0
    for t in problem.task_types:
        slot = models.Slot(id="probe", task_type_id=t.id, starts_at=mid, ends_at=mid + timedelta(hours=24))
        for s in problem.soldiers:
            py = set(idx.check(s, slot)) & STATIC_REASONS
            assert sql_static[(s.id, t.id)] == py, (s.id, t.name, sql_static[(s.id, t.id)], py)
            compared += 1
    assert compared > 1000

    rows = _as_coord(conn, "select soldier_id, category_id, value, reasons, available_days, cycle_days from public.potential_matrix(%s)", cycle)
    assert rows and all(0 <= r[2] <= 1 for r in rows)
    assert all((r[2] > 0) == (r[3] == []) for r in rows)  # a reason exactly when closed

    # the daily count agrees with the matrix: a soldier with value 1 in a category is counted every day
    daily = _as_coord(conn, "select day, category_id, available from public.potential_daily(%s)", cycle)
    full = {}
    for r in rows:
        if r[2] == 1:
            full[r[1]] = full.get(r[1], 0) + 1
    for day, cat, n in daily:
        assert n >= full.get(cat, 0)
    some = {}
    for r in rows:
        if r[2] > 0:
            some[r[1]] = some.get(r[1], 0) + 1
    assert all(n <= some.get(cat, 0) for _, cat, n in daily)


def test_potential_availability_absence_and_exemption_scope(conn):
    cycle = conn.cycle_id
    start, end = conn.execute("select start_date, end_date from cycles where id = %s", (cycle,)).fetchone()
    total = (end - start).days + 1
    rows = _as_coord(conn, "select soldier_id, category_id, best_task_type_id from public.potential_matrix(%s) where value = 1", cycle)
    by_soldier = {}
    for s, c, t in rows:
        by_soldier.setdefault(s, []).append((c, t))
    sid, cells = next((s, c) for s, c in by_soldier.items() if len(c) >= 2)
    (cat_a, task_a), (cat_b, _) = cells[0], cells[1]
    # make sure the soldier has no other records that cut availability
    conn.execute("update absences set status = 'cancelled' where soldier_id = %s", (sid,))
    conn.execute("update exemptions set status = 'cancelled', decision_reason = 'test' where soldier_id = %s", (sid,))
    vac = conn.execute("select id from absence_types limit 1").fetchone()[0]
    conn.execute(
        """insert into absences (soldier_id, absence_type_id, starts_at, ends_at)
           values (%s, %s, (%s::date)::timestamp at time zone 'Asia/Jerusalem', (%s::date + 30)::timestamp at time zone 'Asia/Jerusalem')""",
        (sid, vac, start, start),
    )
    # an exemption type that maps to one duty only, entered "by type" (no explicit list)
    et = conn.execute("insert into exemption_types (name) values ('פטור ממופה') returning id").fetchone()[0]
    conn.execute("insert into exemption_type_duties values (%s, %s, 'excludes')", (et, task_a))
    conn.execute(
        """insert into exemptions (soldier_id, exemption_type_id, kind, start_date, end_date, status, proof_checked_at)
           values (%s, %s, 'full', %s, %s, 'approved', now())""",
        (sid, et, start, end),
    )
    vals = {
        c: (v, r)
        for c, v, r in _as_coord(conn, "select category_id, value, reasons from public.potential_matrix(%s) where soldier_id = %s", cycle, sid)
    }
    assert float(vals[cat_b][0]) == round((total - 30) / total, 2)  # only the absence
    assert float(vals[cat_a][0]) == 0 and vals[cat_a][1] == ["unavailable"]  # the mapped exemption closes only that duty
    doc = conn.execute("select public.build_solver_input(%s)", (cycle,)).fetchone()[0]
    mine = [e for e in doc["exemptions"] if e["soldier_id"] == str(sid)]
    assert mine and mine[0]["excluded_task_type_ids"] == [str(task_a)]


def test_potential_overrides_are_staff_only(conn):
    sid, cat = conn.execute(
        "select sn.soldier_id, (select id from duty_categories limit 1) from cycle_soldier_snapshot sn where cycle_id = %s limit 1",
        (conn.cycle_id,),
    ).fetchone()
    with session_as(conn, COORD):
        conn.execute("insert into potential_overrides (cycle_id, soldier_id, category_id, value, reason) values (%s,%s,%s,0.5,'בדיקה')",
                     (conn.cycle_id, sid, cat))
        by = conn.execute("select created_by from potential_overrides where soldier_id = %s", (sid,)).fetchone()[0]
        assert by == COORD
    with session_as(conn, VIEWER):
        with pytest.raises(psycopg.Error):
            conn.execute("select * from public.potential_matrix(%s)", (conn.cycle_id,))


def test_slot_rank_list_reaches_the_engine_and_notes_stay_internal(conn):
    cycle = conn.cycle_id
    sid = conn.execute("select id from slots where cycle_id = %s order by starts_at limit 1", (cycle,)).fetchone()[0]
    r1, o1, r2, o2 = conn.execute(
        "select (array_agg(id order by sort_order))[2], (array_agg(sort_order order by sort_order))[2], "
        "(array_agg(id order by sort_order))[4], (array_agg(sort_order order by sort_order))[4] from ranks"
    ).fetchone()
    conn.execute(
        "update slots set allowed_rank_ids = %s, instructions = 'התייצבות 09:00', notes = 'איש קשר 050-0000000' where id = %s",
        ([r1, r2], sid),
    )
    conn.execute("select public.snapshot_cycle(%s)", (cycle,))
    doc = conn.execute("select public.build_solver_input(%s)", (cycle,)).fetchone()[0]
    s = next(x for x in doc["slots"] if x["id"] == str(sid))
    assert sorted(s["allowed_ranks"]) == sorted([o1, o2])
    assert all(x["allowed_ranks"] is None for x in doc["slots"] if x["id"] != str(sid))
    models.load_problem(json.dumps(doc))  # the engine accepts the new field
    cols = [r[0] for r in conn.execute(
        "select column_name from information_schema.columns where table_name = 'published_board'").fetchall()]
    assert "instructions" in cols and "notes" not in cols
    task = conn.execute("select id from task_types limit 1").fetchone()[0]
    with session_as(conn, VIEWER):
        assert conn.execute("select count(*) from task_type_aliases").fetchone()[0] == 0
        with pytest.raises(psycopg.Error):
            conn.execute("insert into task_type_aliases (alias, task_type_id) values ('x', %s)", (task,))


def test_tash7_slot_flag_and_weight_reach_the_engine(conn):
    cycle = conn.cycle_id
    sid = conn.execute("select id from slots where cycle_id = %s order by starts_at limit 1", (cycle,)).fetchone()[0]
    conn.execute("update slots set prefer_home_nightly = true, daily_hours = '08:00-17:00' where id = %s", (sid,))
    conn.execute("select public.snapshot_cycle(%s)", (cycle,))
    doc = conn.execute("select public.build_solver_input(%s)", (cycle,)).fetchone()[0]
    assert [(x["prefer_home_nightly"], x["daily_hours"]) for x in doc["slots"] if x["id"] == str(sid)] == [(True, "08:00-17:00")]
    assert doc["settings"]["weights"]["home_nightly_preference"] == 100
    p = models.load_problem(json.dumps(doc))
    assert p.settings.weights.home_nightly_preference == 100


def test_queued_job_dispatch_and_cancel(conn):
    cycle = conn.cycle_id
    conn.execute("update schedule_jobs set status = 'done' where cycle_id = %s and status in ('queued', 'running')", (cycle,))
    conn.execute("update cycles set status = 'review' where id = %s", (cycle,))  # earlier tests published it
    job = _as_coord(conn, "select public.request_schedule(%s)", cycle)[0][0]
    # no pg_net / vault here: nothing is sent, and the job says so
    assert conn.execute("select params ->> 'dispatch' from schedule_jobs where id = %s", (job,)).fetchone()[0] == "unavailable"
    assert _as_coord(conn, "select public.dispatch_configured()")[0][0] is False
    assert _as_coord(conn, "select public.redispatch_schedule(%s)", job)[0][0] == "unavailable"
    assert _as_coord(conn, "select public.schedule_dispatch_response(%s)", job)[0][0] is None
    with session_as(conn, VIEWER):
        with pytest.raises(psycopg.Error):
            conn.execute("select public.cancel_schedule_job(%s)", (job,))
    _as_coord(conn, "select public.cancel_schedule_job(%s)", job)
    assert conn.execute("select status from schedule_jobs where id = %s", (job,)).fetchone()[0] == "failed"


def test_medical_exemption_permits_the_day_duty_and_briefing_reaches_the_engine(conn):
    from mahanroster_solver.eligibility import EligibilityIndex

    cycle = conn.cycle_id
    day_task = conn.execute("select id from task_types where qualifying_duty order by code limit 1").fetchone()[0]
    sid = conn.execute(
        """select s.soldier_id from cycle_soldier_snapshot s where s.cycle_id = %s and not s.qualifies_day_only
             and not ('major' = any(s.populations))
             and not exists (select 1 from exemptions e where e.soldier_id = s.soldier_id and e.status = 'approved')
           order by s.soldier_id limit 1""", (cycle,)).fetchone()[0]
    med = conn.execute("insert into exemption_types (name) values ('רפואי בדיקה') returning id").fetchone()[0]
    conn.execute("insert into exemption_type_duties values (%s, %s, 'qualifies')", (med, day_task))
    start, end = conn.execute("select start_date, end_date from cycles where id = %s", (cycle,)).fetchone()
    conn.execute(
        """insert into exemptions (soldier_id, exemption_type_id, kind, start_date, end_date, status, proof_checked_at)
           values (%s, %s, 'full', %s, %s, 'approved', now())""", (sid, med, start, end))
    k = conn.execute("select id from slots where cycle_id = %s order by starts_at limit 1", (cycle,)).fetchone()[0]
    conn.execute("update slots set briefing_at = starts_at - interval '20 hours' where id = %s", (k,))

    doc = conn.execute("select public.build_solver_input(%s)", (cycle,)).fetchone()[0]
    mine = [e for e in doc["exemptions"] if e["soldier_id"] == str(sid)]
    assert [e["qualifies_task_type_ids"] for e in mine] == [[str(day_task)]]
    assert [x["briefing_at"] for x in doc["slots"] if x["id"] == str(k)][0] is not None
    p = models.load_problem(json.dumps(doc))
    idx = EligibilityIndex(p)
    soldier = next(s for s in p.soldiers if s.id == str(sid))
    day_slots = [s for s in p.slots if s.task_type_id == str(day_task)]
    assert day_slots and "not_qualifying" not in idx.check(soldier, day_slots[0])
    static = conn.execute(
        "select reasons from app.potential_static(%s) where soldier_id = %s and task_type_id = %s", (cycle, sid, day_task)
    ).fetchone()[0]
    assert "not_qualifying" not in static
    conn.execute("update exemptions set status = 'cancelled', decision_reason = 'test' where soldier_id = %s and exemption_type_id = %s", (sid, med))
    conn.execute("update slots set briefing_at = null where id = %s", (k,))


def test_assumed_range_covers_slots_that_end_after_the_cycle(conn):
    cycle = conn.cycle_id
    end = conn.execute("select end_date from cycles where id = %s", (cycle,)).fetchone()[0]
    sid = conn.execute("select id from soldiers where range_valid_until is not null order by id limit 1").fetchone()[0]
    conn.execute("update soldiers set range_valid_until = null where id = %s", (sid,))
    task = conn.execute("select task_type_id from slots where cycle_id = %s limit 1", (cycle,)).fetchone()[0]
    conn.execute(
        """insert into slots (cycle_id, task_type_id, starts_at, ends_at)
           values (%s, %s, (%s::date)::timestamp at time zone 'Asia/Jerusalem' + interval '13 hours',
                           (%s::date + 7)::timestamp at time zone 'Asia/Jerusalem' + interval '13 hours')""",
        (cycle, task, end, end),
    )
    conn.execute("select public.snapshot_cycle(%s)", (cycle,))
    doc = conn.execute("select public.build_solver_input(%s)", (cycle,)).fetchone()[0]
    s = next(x for x in doc["soldiers"] if x["id"] == str(sid))
    assert s["range_valid_until"] == (end + __import__("datetime").timedelta(days=7)).isoformat()


def test_sql_points_match_the_engine(conn):
    from mahanroster_solver.scoring import normalized_points, raw_points

    cycle = conn.cycle_id
    conn.execute("select public.snapshot_cycle(%s)", (cycle,))
    doc = conn.execute("select public.build_solver_input(%s)", (cycle,)).fetchone()[0]
    p = models.load_problem(json.dumps(doc))
    tasks = {t.id: t for t in p.task_types}
    hol = set(p.holidays)
    # a holiday and a load role in play, so the multipliers and the factor are exercised
    leader = next(s for s in p.soldiers if s.load_roles)
    checked = 0
    for k in p.slots[:60]:
        raw, norm = conn.execute("select raw, normalized from app.slot_points(%s, %s)", (k.id, leader.id)).fetchone()
        assert float(raw) == round(raw_points(tasks[k.task_type_id], k.starts_at, k.ends_at, p.settings, hol), 2), k
        assert abs(float(norm) - normalized_points(leader, tasks[k.task_type_id], k.starts_at, k.ends_at, p.settings, hol)) < 0.02
        checked += 1
    assert checked >= 30


def test_candidates_match_the_engine_and_manual_changes(conn):
    from mahanroster_solver.eligibility import EligibilityIndex

    cycle = conn.cycle_id
    conn.execute("update cycles set status = 'review' where id = %s", (cycle,))
    conn.execute("select public.snapshot_cycle(%s)", (cycle,))
    doc = conn.execute("select public.build_solver_input(%s)", (cycle,)).fetchone()[0]
    p = models.load_problem(json.dumps(doc))
    idx = EligibilityIndex(p)
    soldiers = {s.id: s for s in p.soldiers}
    # other-cycle duties: SQL reports them as conflicts instead; a soldier taken off the duty
    # ("removed") is kept out by the engine only – by hand he may be put back on purpose
    ignore = {"busy", "penalty_other", "removed"}
    for k in p.slots[::15]:
        rows = _as_coord(conn, "select soldier_id, reasons from public.slot_candidates(%s)", k.id)
        assert len(rows) == len(p.soldiers)
        for sid, reasons in rows:
            py = set(idx.check(soldiers[str(sid)], k)) - ignore
            assert set(reasons) == py, (k.id, str(sid), reasons, py)

    # manual: replace a draft performer by an eligible soldier, with a reason
    slot, new_sid = None, None
    for k in p.slots:  # a slot with a free, eligible soldier (the test data is random)
        rows = _as_coord(conn, "select soldier_id from public.slot_candidates(%s) where reasons = '{}' and in_slot is null and conflicts = '[]' limit 1", k.id)
        if rows:
            slot, new_sid = k, rows[0][0]
            break
    assert slot is not None
    with pytest.raises(psycopg.Error):
        _as_coord(conn, "select public.manual_assign(%s, 'performer', %s, null, ' ')", slot.id, new_sid)
    aid = _as_coord(conn, "select public.manual_assign(%s, 'performer', %s, null, 'בדיקה')", slot.id, new_sid)[0][0]
    row = conn.execute("select source, manual_reason, points, role from assignments where id = %s", (aid,)).fetchone()
    assert row[0] == "manual" and row[1] == "בדיקה" and float(row[2]) > 0 and row[3] == "performer"
    in_slot = _as_coord(conn, "select in_slot from public.slot_candidates(%s) where soldier_id = %s", slot.id, new_sid)[0][0]
    assert in_slot == "performer"
    with pytest.raises(psycopg.Error):  # twice in the same slot
        _as_coord(conn, "select public.manual_assign(%s, 'reserve', %s, null, 'x')", slot.id, new_sid)
    doc = conn.execute("select public.build_solver_input(%s)", (cycle,)).fetchone()[0]
    assert any(f["slot_id"] == str(slot.id) and f["soldier_id"] == str(new_sid) for f in doc["fixed"])  # kept by the next run
    # a second duty at the same hours: refused, whatever the reason (performer or reserve)
    twin = conn.execute(
        "insert into slots (cycle_id, task_type_id, starts_at, ends_at, performers_needed, reserves_needed) "
        "select cycle_id, task_type_id, starts_at + interval '1 hour', ends_at + interval '1 hour', 1, 1 from slots where id = %s returning id",
        (slot.id,)).fetchone()[0]
    for role in ("performer", "reserve"):
        with pytest.raises(psycopg.Error, match="חופפות"):
            _as_coord(conn, f"select public.manual_assign(%s, '{role}', %s, null, 'בכל זאת')", twin, new_sid)
    conn.execute("delete from slots where id = %s", (twin,))
    _as_coord(conn, "select public.remove_assignment(%s, 'בדיקה')", aid)
    assert conn.execute("select count(*) from assignments where id = %s", (aid,)).fetchone()[0] == 0
    assert conn.execute("select count(*) from audit_log where action = 'remove_assignment' and entity_id = %s", (str(aid),)).fetchone()[0] == 1


def test_no_full_run_on_a_published_cycle(conn):
    cycle = conn.cycle_id
    conn.execute("update schedule_jobs set status = 'done' where cycle_id = %s and status in ('queued', 'running')", (cycle,))
    old = conn.execute("select status from cycles where id = %s", (cycle,)).fetchone()[0]
    conn.execute("update cycles set status = 'published' where id = %s", (cycle,))
    with pytest.raises(psycopg.Error):
        _as_coord(conn, "select public.request_schedule(%s)", cycle)
    conn.execute("update cycles set status = %s where id = %s", (old, cycle))


def test_fairness_groups_and_credit_periods(conn):
    from datetime import timedelta

    cycle = conn.cycle_id
    start, end = conn.execute("select start_date, end_date from cycles where id = %s", (cycle,)).fetchone()
    _as_coord(conn, "select public.compute_potential(%s)", cycle)
    rows = conn.execute(
        "select soldier_id, balance_population, fairness_group, fairness_label from cycle_soldier_snapshot where cycle_id = %s", (cycle,)
    ).fetchall()
    assert rows and all(g and g.startswith(p + ":") and l for _, p, g, l in rows)
    # soldiers of one group share an open category with someone in the group; groups never mix populations
    groups = {}
    for s, p, g, _ in rows:
        groups.setdefault(g, set()).add(p)
    assert all(len(ps) == 1 for ps in groups.values())

    sid = rows[0][0]
    conn.execute("update absences set status = 'cancelled' where soldier_id = %s", (sid,))
    conn.execute("update exemptions set status = 'cancelled', decision_reason = 'test' where soldier_id = %s", (sid,))
    conn.execute("update soldiers set enlistment_date = %s, unit_join_date = null, release_date = null where id = %s", (start + timedelta(days=5), sid))
    course = conn.execute(
        "insert into absence_types (name, credits_load) values ('קורס', true) on conflict (name) do update set credits_load = true returning id"
    ).fetchone()[0]
    leave = conn.execute("select id from absence_types where name = 'חופשה'").fetchone()[0]
    for t, a, b in ((course, 10, 18), (leave, 19, 27), (course, 27, 29)):  # a long course, a leave, a short course
        conn.execute(
            """insert into absences (soldier_id, absence_type_id, starts_at, ends_at)
               values (%s, %s, (%s::date)::timestamp at time zone 'Asia/Jerusalem', (%s::date)::timestamp at time zone 'Asia/Jerusalem')""",
            (sid, t, start + timedelta(days=a), start + timedelta(days=b)),
        )
    doc = conn.execute("select public.build_solver_input(%s)", (cycle,)).fetchone()[0]
    s = next(x for x in doc["soldiers"] if x["id"] == str(sid))
    assert s["fairness_group"]
    assert s["credit_periods"] == [
        {"start": str(start), "end": str(start + timedelta(days=4))},
        {"start": str(start + timedelta(days=10)), "end": str(start + timedelta(days=17))},
    ]
    problem = models.load_problem(json.dumps(doc))  # the engine accepts the new fields
    assert next(x for x in problem.soldiers if x.id == str(sid)).credited_days(start, end) == 13

    # a run's credits are stored per cycle and count in the baseline of a later cycle
    job = conn.execute("insert into schedule_jobs (cycle_id, kind, status) values (%s, 'full', 'running') returning id", (cycle,)).fetchone()[0]
    conn.execute(
        "update schedule_jobs set status = 'done', result = %s where id = %s",
        (Jsonb({"credits": [{"soldier_id": str(sid), "days": 24, "points": 7.5}]}), job),
    )
    assert conn.execute("select days, points from cycle_credits where cycle_id = %s", (cycle,)).fetchall() == [(24, 7.5)]
    conn.execute("update soldiers set enlistment_date = null where id = %s", (sid,))
    conn.execute("update absences set status = 'cancelled' where soldier_id = %s", (sid,))


def test_gaf_named_by_a_framework_path_is_merged(conn):
    sid, gaf = conn.execute("select id, gaf_id from soldiers where is_active order by id limit 1").fetchone()
    name = "גף בדיקה"
    conn.execute("update org_units set name = %s where id = %s", (name, gaf))
    path = conn.execute(
        "insert into org_units (kind, name) values ('gaf', %s) returning id", (f'מה"ן - מלמסים/{name}/צוות בדיקה - מלמסים',)
    ).fetchone()[0]
    a = conn.execute("select id from assignments where soldier_id = %s limit 1", (sid,)).fetchone()
    if a:
        conn.execute("update assignments set gaf_id = %s where id = %s", (path, a[0]))
    assert conn.execute("select app.merge_gaf_paths()").fetchone()[0] == 1
    assert conn.execute("select merged_into_id, active_to is not null from org_units where id = %s", (path,)).fetchone() == (gaf, True)
    if a:
        assert conn.execute("select gaf_id from assignments where id = %s", (a[0],)).fetchone()[0] == gaf
    cols = [d.name for d in conn.execute("select * from published_board limit 0").description]
    assert {"performer_gafim", "reserve_gafim"} <= set(cols)


def test_unpublish_by_the_coordinator_before_the_cycle_starts(conn):
    import time

    cycle = conn.cycle_id
    name, status0 = conn.execute("select name, status from cycles where id = %s", (cycle,)).fetchone()
    conn.execute("update schedule_jobs set status = 'done' where cycle_id = %s and status in ('queued', 'running')", (cycle,))
    conn.execute("update cycles set status = 'published', published_at = now() where id = %s", (cycle,))
    conn.execute(
        """update assignments a set status = case when a.role = 'performer' then 'assigned' else 'reserve_idle' end::assignment_status
           from slots s where s.id = a.slot_id and s.cycle_id = %s and a.status = 'draft'""", (cycle,))
    published = conn.execute(
        "select count(*) from assignments a join slots s on s.id = a.slot_id where s.cycle_id = %s and a.status in ('assigned','reserve_idle')",
        (cycle,)).fetchone()[0]

    def call(user, amr_age=0):
        now = int(time.time())
        claims = {"sub": str(user), "aal": "aal2",
                  "amr": [{"method": "totp", "timestamp": now - amr_age}, {"method": "password", "timestamp": now - amr_age}]}
        conn.execute("begin")
        conn.execute("set local role authenticated")
        conn.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(user),))
        conn.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps(claims),))
        try:
            return conn.execute("select public.unpublish_cycle(%s)", (cycle,)).fetchone()[0]
        finally:
            conn.execute("rollback" if conn.info.transaction_status == 3 else "commit")

    with pytest.raises(psycopg.Error):
        call(DEPUTY_ACTIVE)
    assert conn.execute("select status from cycles where id = %s", (cycle,)).fetchone()[0] == "published"

    # a cycle that already started cannot be unpublished
    start = conn.execute("select start_date from cycles where id = %s", (cycle,)).fetchone()[0]
    conn.execute("update cycles set start_date = current_date - 1 where id = %s", (cycle,))
    with pytest.raises(psycopg.Error):
        call(COORD, 10)
    conn.execute("update cycles set start_date = %s where id = %s", (start, cycle))

    assert call(COORD, 10) == published
    assert conn.execute("select status, published_at from cycles where id = %s", (cycle,)).fetchone() == ("review", None)
    assert conn.execute("select count(*) from published_board where cycle_id = %s", (cycle,)).fetchone()[0] == 0
    row = conn.execute("select after from audit_log where action = 'unpublish' and entity_id = %s order by at desc limit 1", (str(cycle),)).fetchone()
    assert row and row[0]["assignments_returned"] == published
    conn.execute("update cycles set status = %s where id = %s", (status0, cycle))


def test_gaf_commander_reads_everything_and_writes_nothing(conn):
    sid = conn.execute("select id from soldiers where is_active order by id limit 1").fetchone()[0]
    uid = _as_coord(conn, "select public.create_user(%s, %s, 'gaf_commander', %s)", "cmd.gaf1", "temp-pass-123", sid)[0][0]
    assert conn.execute("select username, must_change_password, soldier_id from app_users where id = %s", (uid,)).fetchone() == ("cmd.gaf1", True, sid)
    assert conn.execute("select count(*) from auth.identities where user_id = %s", (uid,)).fetchone()[0] == 1
    assert conn.execute("select encrypted_password = crypt('temp-pass-123', encrypted_password) from auth.users where id = %s", (uid,)).fetchone()[0]
    users = _as_coord(conn, "select username, roles from public.list_users()")
    assert any(u == "cmd.gaf1" and r[0]["role"] == "gaf_commander" for u, r in users)
    with pytest.raises(psycopg.Error):  # a second account with the same name
        _as_coord(conn, "select public.create_user(%s, %s, 'gaf_commander', null)", "cmd.gaf1", "temp-pass-123")

    cycle = conn.cycle_id
    with session_as(conn, uid) as c:
        assert c.execute("select count(*) from soldiers").fetchone()[0] > 0
        assert c.execute("select count(*) from exemptions").fetchone()[0] >= 0
        assert c.execute("select count(*) from public.potential_matrix(%s)", (cycle,)).fetchone()[0] > 0
        assert c.execute("update soldiers set full_name = full_name where id = %s", (sid,)).rowcount == 0  # RLS: nothing to update
    with session_as(conn, uid) as c:
        with pytest.raises(psycopg.Error):
            c.execute("insert into absences (soldier_id, absence_type_id, starts_at, ends_at) select %s, id, now(), now() + interval '1 day' from absence_types limit 1", (sid,))
    with session_as(conn, uid) as c:
        with pytest.raises(psycopg.Error):
            c.execute("select public.create_user('x.y', 'temp-pass-123', 'gaf_commander', null)")
    # without the second factor: nothing
    with session_as(conn, uid, aal="aal1") as c:
        assert c.execute("select count(*) from soldiers").fetchone()[0] == 0

    _as_coord(conn, "select public.reset_user_password(%s, %s)", uid, "another-pass-456")
    assert conn.execute("select encrypted_password = crypt('another-pass-456', encrypted_password) from auth.users where id = %s", (uid,)).fetchone()[0]
    _as_coord(conn, "select public.set_user_locked(%s, true)", uid)
    with session_as(conn, uid) as c:
        assert c.execute("select count(*) from soldiers").fetchone()[0] == 0  # locked = no role


def test_delete_task_type_only_when_unused(conn):
    used = conn.execute("select task_type_id from slots limit 1").fetchone()[0]
    with pytest.raises(psycopg.Error, match="בשימוש"):
        _as_coord(conn, "select public.delete_task_type(%s)", used)
    assert conn.execute("select count(*) from task_types where id = %s", (used,)).fetchone()[0] == 1

    new = conn.execute(
        "insert into task_types (code, name, weight) values ('tmp_del', 'תורנות למחיקה', 1) returning id").fetchone()[0]
    conn.execute("insert into task_type_aliases (alias, task_type_id) values ('כינוי למחיקה', %s)", (new,))
    with session_as(conn, VIEWER) as c, pytest.raises(psycopg.Error):
        c.execute("select public.delete_task_type(%s)", (new,))
    _as_coord(conn, "select public.delete_task_type(%s)", new)
    assert conn.execute("select count(*) from task_types where id = %s", (new,)).fetchone()[0] == 0
    assert conn.execute("select count(*) from task_type_aliases where alias = 'כינוי למחיקה'").fetchone()[0] == 0

def test_reset_dynamic_data_keeps_system_settings(conn):
    sql = (ROOT / "supabase/reset_dynamic_data.sql").read_text(encoding="utf-8")
    body = sql.split("begin;", 1)[1].rsplit("commit;", 1)[0]
    kept = ("populations", "ranks", "load_roles", "exemption_types", "absence_types",
            "day_types", "calendar_days", "duty_categories", "task_types", "task_type_aliases", "exemption_type_duties",
            "weight_history")
    count = lambda t: conn.execute(f"select count(*) from {t}").fetchone()[0]
    with conn.transaction():
        conn.execute("update app_users set soldier_id = (select id from soldiers limit 1) where id = %s", (COORD,))
        conn.execute("insert into weight_history (multiplier_key, value, effective_from) values ('weekend_multiplier', 2, current_date)")
        # a soldier's account (goes) next to the staff accounts (stay); the unit key check is a setting (stays)
        sid = conn.execute("select id from soldiers order by id desc limit 1").fetchone()[0]
        su = conn.execute("select app.create_auth_user('reset.soldier@users.invalid', 'x-long-password')").fetchone()[0]
        conn.execute("delete from app_users where soldier_id = %s", (sid,))
        conn.execute("insert into app_users (id, username, soldier_id) values (%s, 'reset.soldier', %s)", (su, sid))
        conn.execute("insert into user_roles (user_id, role) values (%s, 'soldier')", (su,))
        # the soldier cancelled an absence of his – the data points at the account (it goes first)
        conn.execute("""insert into absences (soldier_id, absence_type_id, starts_at, ends_at, status, cancelled_by)
                        select %s, id, now(), now() + interval '1 day', 'cancelled', %s from absence_types limit 1""", (sid, su))
        assert count("absences where cancelled_by is not null") == 1
        conn.execute("insert into soldier_invites (soldier_id, code_hash, expires_at) values (%s, 'x', now() + interval '1 day') on conflict do nothing", (sid,))
        conn.execute("insert into settings (key, value) values ('unit_key_check', '\"abc\"') on conflict (key) do update set value = excluded.value")
        staff = count("app_users") - 1
        settings = count("settings")
        before = {t: count(t) for t in kept}
        soldiers, multipliers = count("soldiers"), count("weight_history where task_type_id is null")
        assert soldiers > 0 and count("task_types") > 0
        conn.execute(body)
        assert {t: count(t) for t in kept} == before
        for t in ("cycles", "slots", "assignments", "exemptions", "schedule_jobs", "cycle_soldier_snapshot",
                  "soldiers"):
            assert count(t) == 0, t
        assert count("org_units where kind = 'gaf'") == 0 and count("org_units where kind = 'unit'") == 1
        assert count("weight_history where task_type_id is null") == multipliers
        assert count("reset_backup.soldiers") == soldiers
        assert count("app_users where soldier_id is not null") == 0
        assert count("app_users") == staff and count(f"auth.users where id = '{su}'") == 0
        assert count("soldier_invites") == 0 and count("reset_backup.soldier_invites") >= 1
        assert count("settings") == settings and count("settings where key = 'unit_key_check'") == 1
        # feedback and the audit log go too; the log keeps one record – this reset
        assert count("feedback") == 0 and count("feedback_quota") == 0
        assert count("audit_log") == 1
        log = conn.execute("select after from audit_log where action = 'reset_dynamic_data' order by at desc limit 1").fetchone()[0]
        assert log["removed"]["soldiers"] == soldiers and log["removed"]["soldier_accounts"] == 1
        raise psycopg.Rollback()


def test_restore_catalog_after_an_old_reset(conn):
    """The old reset deleted the catalog too; migration 48 puts it back from reset_backup."""
    reset = (ROOT / "supabase/reset_dynamic_data.sql").read_text(encoding="utf-8")
    restore = next((ROOT / "supabase/migrations").glob("*_restore_catalog.sql")).read_text(encoding="utf-8")
    catalog = ("task_types", "task_type_aliases", "exemption_type_duties", "weight_history where task_type_id is not null")
    count = lambda t: conn.execute(f"select count(*) from {t}").fetchone()[0]
    with conn.transaction():
        conn.execute(reset.split("begin;", 1)[1].rsplit("commit;", 1)[0])
        conn.execute("insert into task_type_aliases (alias, task_type_id) select 'שם מהבסיס', id from task_types limit 1")
        before = {t: count(t) for t in catalog}
        names = conn.execute("select array_agg(name order by name) from task_types").fetchone()[0]
        # what the old script did on top: copy, then delete the catalog
        for t in ("task_types", "task_type_aliases", "exemption_type_duties", "weight_history"):
            conn.execute(f"drop table if exists reset_backup.{t}")
            conn.execute(f"create table reset_backup.{t} as table public.{t}")
        conn.execute("delete from weight_history where task_type_id is not null")
        conn.execute("delete from task_types")
        assert count("task_types") == 0 and count("task_type_aliases") == 0
        conn.execute(restore)
        assert {t: count(t) for t in catalog} == before
        assert conn.execute("select array_agg(name order by name) from task_types").fetchone()[0] == names
        # a catalog that is there is left alone
        conn.execute("update task_types set name = name || ' *' where id = (select id from task_types limit 1)")
        conn.execute(restore)
        assert count("task_types where name like '% *'") == 1
        raise psycopg.Rollback()


def test_task_rank_list_limits_potential_and_engine_input(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        conn.execute("select public.snapshot_cycle(%s)", (cycle,))
        tid = conn.execute("select id from task_types where is_active and qualifying_duty = false order by code limit 1").fetchone()[0]
        cat = conn.execute("insert into duty_categories (name) values ('קטגוריה לבדיקת דרגות') returning id").fetchone()[0]
        conn.execute("update task_types set category_id = %s where id = %s", (cat, tid))
        rank, order = conn.execute(
            "select r.id, r.sort_order from cycle_soldier_snapshot sn join ranks r on r.sort_order = sn.rank_order "
            "where sn.cycle_id = %s limit 1", (cycle,)).fetchone()
        conn.execute("update task_types set allowed_rank_ids = array[%s]::uuid[], rank_min_id = null, rank_max_id = null, "
                     "eligible_populations = '{}' where id = %s", (rank, tid))
        rows = conn.execute(
            "select sn.rank_order, 'rank' = any(p.reasons) from app.potential_static(%s) p "
            "join cycle_soldier_snapshot sn on sn.soldier_id = p.soldier_id and sn.cycle_id = %s where p.task_type_id = %s",
            (cycle, cycle, tid)).fetchall()
        assert rows and all(blocked == (r != order) for r, blocked in rows)
        doc = conn.execute("select public.build_solver_input(%s)", (cycle,)).fetchone()[0]
        task = next(t for t in doc["task_types"] if t["id"] == str(tid))
        assert task["allowed_ranks"] == [order]
        raise psycopg.Rollback()


def test_shachar_only_duty_in_potential_candidates_and_engine(conn):
    from mahanroster_solver.eligibility import EligibilityIndex

    cycle = conn.cycle_id
    with conn.transaction():
        conn.execute("select public.snapshot_cycle(%s)", (cycle,))
        tid = conn.execute("select id from task_types where is_active and qualifying_duty = false order by code limit 1").fetchone()[0]
        cat = conn.execute("insert into duty_categories (name) values ('קטגוריה לבדיקת שחר') returning id").fetchone()[0]
        conn.execute("update task_types set category_id = %s, shachar_compatible = true, shachar_only = true, service_restriction = 'any', "
                     "eligible_populations = '{}', allowed_rank_ids = null, rank_min_id = null, rank_max_id = null, gender = null "
                     "where id = %s", (cat, tid))
        # only שח"ר may be marked shachar_only
        with pytest.raises(psycopg.errors.CheckViolation), conn.transaction():
            conn.execute("update task_types set shachar_compatible = false where id = %s", (tid,))
        mand, career = [
            conn.execute("select soldier_id from cycle_soldier_snapshot where cycle_id = %s and service_type = %s limit 1",
                         (cycle, st)).fetchone()[0] for st in ("mandatory", "career")]
        conn.execute("update cycle_soldier_snapshot set is_shachar = (soldier_id in (%s, %s)) where cycle_id = %s", (mand, career, cycle))
        blocked = {str(r[0]): r[1] for r in conn.execute(
            "select soldier_id, 'shachar_only' = any(reasons) from app.potential_static(%s) where task_type_id = %s", (cycle, tid)).fetchall()}
        assert blocked[str(mand)] is False                       # a mandatory שח"ר soldier may
        assert blocked[str(career)] is True                      # שח"ר is mandatory service only
        assert sum(not v for v in blocked.values()) == 1         # nobody else

        slot_id = conn.execute("select id from slots where cycle_id = %s limit 1", (cycle,)).fetchone()[0]
        conn.execute("update slots set task_type_id = %s, allowed_rank_ids = null, rank_min_id = null, rank_max_id = null, gender = null "
                     "where id = %s", (tid, slot_id))
        with session_as(conn, COORD) as c:
            cand = {str(r[0]): r[1] for r in c.execute("select soldier_id, reasons from public.slot_candidates(%s)", (slot_id,)).fetchall()}
        assert "shachar_only" not in cand[str(mand)] and "shachar_only" in cand[str(career)]

        doc = conn.execute("select public.build_solver_input(%s)", (cycle,)).fetchone()[0]
        task = next(t for t in doc["task_types"] if t["id"] == str(tid))
        assert task["shachar_only"] is True
        problem = models.load_problem(json.dumps(doc))
        idx = EligibilityIndex(problem)
        k = next(x for x in problem.slots if x.id == str(slot_id))
        for sv in problem.soldiers:
            assert ("shachar_only" in idx.check(sv, k)) == blocked[sv.id], sv.id
        raise psycopg.Rollback()


def test_tash_level_and_duty_rule(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        conn.execute("select public.snapshot_cycle(%s)", (cycle,))
        slot_id, tid = conn.execute("select id, task_type_id from slots where cycle_id = %s order by starts_at limit 1", (cycle,)).fetchone()
        conn.execute("update task_types set service_restriction = 'any', eligible_populations = '{}', allowed_rank_ids = null, "
                     "rank_min_id = null, rank_max_id = null, gender = null, qualifying_duty = false, shachar_compatible = true, "
                     "shachar_only = false where id = %s", (tid,))
        # a week-long duty that covers every night, Sunday to Sunday
        conn.execute("update slots set starts_at = '2027-01-03 08:00+02', ends_at = '2027-01-10 08:00+02', daily_hours = null, "
                     "allowed_rank_ids = null, rank_min_id = null, rank_max_id = null, gender = null where id = %s", (slot_id,))
        sid = conn.execute("select sn.soldier_id from cycle_soldier_snapshot sn join soldiers so on so.id = sn.soldier_id "
                           "where sn.cycle_id = %s and sn.service_type = 'mandatory' and not sn.is_shachar "
                           "and not app.home_nightly_on(so, current_date) and not app.home_nightly_on(so, '2027-01-01') "
                           "order by sn.soldier_id limit 1", (cycle,)).fetchone()[0]
        nights = conn.execute("select array_length(app.slot_nights(s), 1) from slots s where id = %s", (slot_id,)).fetchone()[0]
        assert nights == 7

        def why():
            with session_as(conn, COORD) as c:
                rows = c.execute("select soldier_id, reasons from public.slot_candidates(%s)", (slot_id,)).fetchall()
            return dict((str(r[0]), r[1]) for r in rows)[str(sid)]

        conn.execute("update soldiers set tash_level = 3 where id = %s", (sid,))
        assert "tash_nights" in why()                    # 3 nights home = at most 4 on base
        conn.execute("update task_types set tash_rule = 'home' where id = %s", (tid,))
        assert "tash_nights" not in why()                # fit for הת"ש: no nights on base
        conn.execute("update task_types set tash_rule = 'closed' where id = %s", (tid,))
        assert "tash_closed" in why()
        conn.execute("update task_types set tash_rule = 'auto' where id = %s", (tid,))
        conn.execute("update soldiers set tash_level = 7 where id = %s", (sid,))
        assert "home_nightly" in why()                   # level 7 = ת"ש 7
        with pytest.raises(psycopg.errors.CheckViolation), conn.transaction():
            conn.execute("update soldiers set tash_level = 2 where id = %s", (sid,))

        conn.execute("update soldiers set tash_level = 4 where id = %s", (sid,))
        doc = conn.execute("select public.build_solver_input(%s)", (cycle,)).fetchone()[0]
        assert next(s for s in doc["soldiers"] if s["id"] == str(sid))["tash_level"] == 4
        assert all(isinstance(x["home_nightly"], bool) for x in doc["soldiers"])   # never null
        assert next(t for t in doc["task_types"] if t["id"] == str(tid))["tash_rule"] == "auto"
        problem = models.load_problem(json.dumps(doc))
        from mahanroster_solver.eligibility import EligibilityIndex
        idx = EligibilityIndex(problem)
        sv = next(x for x in problem.soldiers if x.id == str(sid))
        k = next(x for x in problem.slots if x.id == str(slot_id))
        assert "tash_nights" in idx.check(sv, k) and "tash_nights" in why()   # the engine agrees
        raise psycopg.Rollback()


def test_surprise_slot_added_after_publish(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        base = conn.execute("select id, task_type_id, starts_at, ends_at from slots where cycle_id = %s and not is_penalty_slot "
                            "order by starts_at limit 1", (cycle,)).fetchone()
        sid = conn.execute("select id from soldiers where is_active limit 1").fetchone()[0]
        new = conn.execute(
            "insert into slots (cycle_id, task_type_id, starts_at, ends_at, performers_needed, reserves_needed, is_surprise) "
            "values (%s, %s, %s, %s, 1, 0, true) returning id", (cycle, base[1], base[2], base[3])).fetchone()[0]
        plain = conn.execute("select raw from app.slot_points(%s, %s)", (base[0], sid)).fetchone()[0]
        surprise = conn.execute("select raw from app.slot_points(%s, %s)", (new, sid)).fetchone()[0]
        assert float(surprise) == pytest.approx(float(plain) * 1.5, abs=0.01)
        doc = conn.execute("select public.build_solver_input(%s, 'stability')", (cycle,)).fetchone()[0]
        assert next(s for s in doc["slots"] if s["id"] == str(new))["is_surprise"] is True
        assert float(doc["settings"]["surprise_multiplier"]) == 1.5
        # publish only the additions; the cycle stays published
        conn.execute("update cycles set status = 'published', published_at = now() where id = %s", (cycle,))
        conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status) "
                     "select %s, id, gaf_id, 'performer', 'draft' from soldiers where id = %s", (new, sid))
        n = _as_coord(conn, "select public.publish_additions(%s)", cycle)[0][0]
        assert n >= 1
        assert conn.execute("select status from assignments where slot_id = %s", (new,)).fetchone()[0] == "assigned"
        assert conn.execute("select status from cycles where id = %s", (cycle,)).fetchone()[0] == "published"
        raise psycopg.Rollback()


def test_activate_reserve_whole_and_partial(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        conn.execute("update cycles set status = 'published', published_at = now() where id = %s", (cycle,))
        tid = conn.execute("select task_type_id from slots where cycle_id = %s limit 1", (cycle,)).fetchone()[0]
        a, b, c, d = [r[0] for r in conn.execute("select id from soldiers where is_active order by id limit 4").fetchall()]

        # whole duty: performer dropped, reserve performs
        k1 = conn.execute("insert into slots (cycle_id, task_type_id, starts_at, ends_at) values "
                          "(%s, %s, now() + interval '30 days', now() + interval '31 days') returning id", (cycle, tid)).fetchone()[0]
        p1 = conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status) select %s, id, gaf_id, 'performer', 'assigned' from soldiers where id = %s returning id", (k1, a)).fetchone()[0]
        r1 = conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status, paired_assignment_id) select %s, id, gaf_id, 'reserve', 'reserve_idle', %s from soldiers where id = %s returning id", (k1, p1, b)).fetchone()[0]
        _as_coord(conn, "select public.activate_reserve(%s)", r1)
        assert conn.execute("select status, points from assignments where id = %s", (p1,)).fetchone() == ("dropped", 0)
        st, pts = conn.execute("select status, points from assignments where id = %s", (r1,)).fetchone()
        assert st == "reserve_activated" and pts > 0
        # the board shows the activated reserve as the performer
        board = conn.execute("select performers, reserves from published_board where slot_id = %s", (k1,)).fetchone()
        assert board is None or (len(board[0]) == 1 and board[1] == [])
        # engine input: the activated reserve is the performer; the dropped one is gone
        doc = conn.execute("select public.build_solver_input(%s, 'stability')", (cycle,)).fetchone()[0]
        fixed = [f for f in doc["fixed"] if f["slot_id"] == str(k1)]
        assert fixed == [{"slot_id": str(k1), "soldier_id": str(b), "role": "performer"}]
        # and everywhere load is counted: the candidates of another duty count the activated reserve's points
        k3 = conn.execute("insert into slots (cycle_id, task_type_id, starts_at, ends_at) values "
                          "(%s, %s, now() + interval '50 days', now() + interval '51 days') returning id", (cycle, tid)).fetchone()[0]
        got = _as_coord(conn, "select cycle_points from public.slot_candidates(%s) where soldier_id = %s", k3, b)
        base = conn.execute("select baseline_score from cycle_soldier_snapshot where cycle_id = %s and soldier_id = %s", (cycle, b)).fetchone()
        assert got and base
        assert float(got[0][0]) >= float(base[0]) + float(pts) - 0.01
        assert conn.execute("select app.performs('reserve', 'reserve_activated'), app.performs('reserve', 'reserve_idle')").fetchone() == (True, False)

        # partial: a 3-day duty, the reserve takes over from day 2
        k2 = conn.execute("insert into slots (cycle_id, task_type_id, starts_at, ends_at) values "
                          "(%s, %s, now() + interval '40 days', now() + interval '43 days') returning id", (cycle, tid)).fetchone()[0]
        p2 = conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status) select %s, id, gaf_id, 'performer', 'assigned' from soldiers where id = %s returning id", (k2, c)).fetchone()[0]
        r2 = conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status) select %s, id, gaf_id, 'reserve', 'reserve_idle' from soldiers where id = %s returning id", (k2, d)).fetchone()[0]
        full = float(conn.execute("select raw from app.slot_points(%s, %s)", (k2, c)).fetchone()[0])
        _as_coord(conn, "select public.activate_reserve(%s, 1)", r2)
        sp, pp = conn.execute("select status, points from assignments where id = %s", (p2,)).fetchone()
        sr, pr = conn.execute("select status, points from assignments where id = %s", (r2,)).fetchone()
        assert sp == "done" and sr == "reserve_activated"
        assert float(pp) + float(pr) == pytest.approx(full, abs=0.02) and 0 < float(pp) < full
        doc = conn.execute("select public.build_solver_input(%s, 'stability')", (cycle,)).fetchone()[0]
        assert [f["soldier_id"] for f in doc["fixed"] if f["slot_id"] == str(k2)] == [str(d)]
        # not twice
        with pytest.raises(psycopg.Error):
            _as_coord(conn, "select public.activate_reserve(%s)", r2)
        raise psycopg.Rollback()



def test_major_holidays_have_their_own_multiplier(conn):
    um = lambda day: float(conn.execute(
        "select app.unit_multiplier(%s::date, false, (%s::date + time '08:00'), (%s::date + time '08:00' + interval '1 day'))",
        (day, day, day)).fetchone()[0])
    with conn.transaction():
        conn.execute("insert into calendar_days (day, day_type, note) values ('2031-09-18', 'major_holiday', 'ראש השנה א׳'), "
                     "('2031-10-01', 'holiday', 'סוכות') on conflict (day) do update set day_type = excluded.day_type")
        assert um("2031-09-18") == 6          # ראש השנה: the dedicated multiplier, not the regular holiday one
        assert um("2031-10-01") == 2          # a regular holiday
        assert conn.execute("select app.is_holiday('2031-09-18')").fetchone()[0]
        # counts as a holiday for weekend balancing (2031-09-18 is a Thursday)
        assert conn.execute("select app.weekend_units('2031-09-18 08:00+03', '2031-09-19 08:00+03')").fetchone()[0] == 1
        conn.execute("update score_multipliers set value = 8 where name = 'ראש השנה, יום כיפור ופסח'")  # up to 10
        raise psycopg.Rollback()


def test_multipliers_by_holiday_name_and_day(conn):
    um = lambda day: float(conn.execute(
        "select app.unit_multiplier(%s::date, false, (%s::date + time '08:00'), (%s::date + time '08:00' + interval '1 day'))",
        (day, day, day)).fetchone()[0])
    with conn.transaction():
        conn.execute("""insert into calendar_days (day, day_type, source, note) values
            ('2027-04-21', 'major_holiday_eve', 'hebcal', 'ערב פסח'), ('2027-04-22', 'major_holiday', 'hebcal', 'פסח'),
            ('2027-04-27', 'major_holiday_eve', 'hebcal', 'ערב שביעי של פסח'), ('2027-04-28', 'major_holiday', 'hebcal', 'שביעי של פסח'),
            ('2027-06-10', 'holiday_eve', 'hebcal', 'ערב שבועות'), ('2027-06-11', 'holiday', 'hebcal', 'שבועות'),
            ('2027-10-15', 'holiday_eve', 'hebcal', 'ערב סוכות'), ('2027-10-16', 'holiday', 'hebcal', 'סוכות'),
            ('2027-10-22', 'holiday_eve', 'hebcal', 'הושענא רבה (ערב שמיני עצרת)'),
            ('2027-10-23', 'holiday', 'hebcal', 'שמיני עצרת / שמחת תורה')
            on conflict (day) do nothing""")
        conn.execute("select app.label_holidays()")
        rows = conn.execute("select note, holiday || '/' || holiday_kind from calendar_days where day between '2027-10-14' and '2027-10-24'").fetchall()
        got = [r[1] for r in rows]
        assert dict(rows)["ערב סוכות"] == "sukkot/eve" and dict(rows)["סוכות"] == "sukkot/day"
        assert dict(rows)["הושענא רבה (ערב שמיני עצרת)"] == "sukkot/eve" and dict(rows)["שמיני עצרת / שמחת תורה"] == "sukkot/day"
        assert got.count("sukkot/chol_hamoed") == 5
        assert not conn.execute("select app.is_holiday('2027-10-18')").fetchone()[0]   # חול המועד is not a holiday day
        conn.execute("update score_multipliers set is_active = false")
        conn.execute("insert into score_multipliers (name, value, holidays, holiday_kinds) values "
                     "('ערבי חגים מרכזיים', 7, '{rosh_hashana,yom_kippur,sukkot,pesach}', '{eve}'), "
                     "('חול המועד', 1.5, '{}', '{chol_hamoed}'), ('שאר החגים', 2, '{shavuot,independence}', '{}')")
        assert um("2027-10-15") == 7       # ערב סוכות
        assert um("2027-10-16") == 1       # סוכות itself: no rule here
        assert um("2027-10-18") == 1.5     # חול המועד סוכות
        assert um("2027-06-10") == 2       # ערב שבועות: "שאר החגים"
        conn.execute("insert into calendar_days (day, day_type, source, note, holiday, holiday_kind) values "
                     "('2027-12-27', 'observance', 'hebcal', 'חנוכה', 'hanukkah', 'day') on conflict (day) do nothing")
        conn.execute("insert into score_multipliers (name, value, holiday_kinds) values ('כל יום חג', 3, '{day}')")
        assert um("2027-12-27") == 1       # חנוכה is not a rest day: "any holiday" leaves it out
        conn.execute("insert into score_multipliers (name, value, holidays) values ('חנוכה', 1.2, '{hanukkah}')")
        assert um("2027-12-27") == 1.2     # by name it counts
        with pytest.raises(psycopg.errors.CheckViolation), conn.transaction():
            conn.execute("insert into score_multipliers (name, value, holiday_kinds) values ('x', 2, '{tomorrow}')")
        cycle = conn.cycle_id
        conn.execute("select public.snapshot_cycle(%s)", (cycle,))
        doc = conn.execute("select public.build_solver_input(%s)", (cycle,)).fetchone()[0]
        m = next(x for x in doc["settings"]["multipliers"] if x["name"] == "ערבי חגים מרכזיים")
        assert m["holiday_kinds"] == ["eve"] and "sukkot" in m["holidays"]
        assert isinstance(doc["settings"]["day_holidays"], dict)
        models.load_problem(json.dumps(doc))
        raise psycopg.Rollback()


def test_recent_holiday_duties(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        conn.execute("select public.snapshot_cycle(%s)", (cycle,))
        slot_id, day = conn.execute("select id, (starts_at at time zone 'Asia/Jerusalem')::date from slots "
                                    "where cycle_id = %s and not is_penalty_slot order by starts_at limit 1", (cycle,)).fetchone()
        sid, other = [r[0] for r in conn.execute("select soldier_id from cycle_soldier_snapshot where cycle_id = %s order by soldier_id limit 2", (cycle,))]
        conn.execute("delete from assignments where slot_id = %s", (slot_id,))
        conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status) "
                     "select %s, id, gaf_id, 'performer', 'assigned' from soldiers where id = %s", (slot_id, sid))
        conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status) "
                     "select %s, id, gaf_id, 'reserve', 'reserve_idle' from soldiers where id = %s", (slot_id, other))
        conn.execute("insert into calendar_days (day, day_type, note) values (%s, 'holiday', 'חג בדיקה') "
                     "on conflict (day) do update set day_type = 'holiday'", (day,))
        since = day - timedelta(days=30)
        dutiesq = "select soldier_id::text, day from app.holiday_duties(%s, %s)"
        conn.execute("update cycles set status = 'review' where id = %s", (cycle,))
        before = set(conn.execute(dutiesq, (since, day)).fetchall())
        assert (str(sid), day) not in before                              # not published yet: does not count
        conn.execute("update cycles set status = 'published' where id = %s", (cycle,))
        after = set(conn.execute(dutiesq, (since, day)).fetchall())
        assert (str(sid), day) in after and (str(other), day) not in after - before   # the performer, not an idle reserve
        with session_as(conn, COORD) as c:
            rows = c.execute("select soldier_id from public.recent_holiday_duties(%s, %s)", (since, day)).fetchall()
        assert str(sid) in {str(r[0]) for r in rows}
        conn.execute("select public.snapshot_cycle(%s)", (cycle,))
        doc = conn.execute("select public.build_solver_input(%s)", (cycle,)).fetchone()[0]
        assert all(isinstance(x["recent_holiday"], bool) for x in doc["soldiers"])
        # a day retyped to a custom type still counts by its name
        conn.execute("insert into day_types (code, name) values ('custom_sk', 'סוכות שלי') on conflict do nothing")
        conn.execute("update calendar_days set day_type = 'custom_sk', holiday = 'sukkot', holiday_kind = 'eve' where day = %s", (day,))
        assert (str(sid), day) in set(conn.execute(dutiesq, (since, day)).fetchall())
        # an observance does not
        conn.execute("update calendar_days set day_type = 'observance', holiday = 'hanukkah', holiday_kind = 'day' where day = %s", (day,))
        assert (str(sid), day) not in set(conn.execute(dutiesq, (since, day)).fetchall())
        models.load_problem(json.dumps(doc))
        raise psycopg.Rollback()


def test_holiday_table_cells(conn):
    um = lambda day: float(conn.execute(
        "select app.unit_multiplier(%s::date, false, (%s::date + time '08:00'), (%s::date + time '08:00' + interval '1 day'))",
        (day, day, day)).fetchone()[0])
    with conn.transaction():
        conn.execute("update score_multipliers set is_active = false")
        conn.execute("insert into calendar_days (day, day_type, source, note, holiday, holiday_kind) values "
                     "('2033-10-07', 'major_holiday_eve', 'hebcal', 'ערב סוכות', 'sukkot', 'eve') "
                     "on conflict (day) do update set holiday = 'sukkot', holiday_kind = 'eve'")
        conn.execute("insert into score_multipliers (name, value, holidays, holiday_kinds, holiday_cell) "
                     "values ('סוכות · ערב חג', 5, '{sukkot}', '{eve}', true)")
        assert um("2033-10-07") == 5
        with pytest.raises(psycopg.errors.UniqueViolation), conn.transaction():   # one row per cell
            conn.execute("insert into score_multipliers (name, value, holidays, holiday_kinds, holiday_cell) "
                         "values ('עוד אחד', 4, '{sukkot}', '{eve}', true)")
        with pytest.raises(psycopg.errors.CheckViolation), conn.transaction():    # a cell is one holiday, one day
            conn.execute("insert into score_multipliers (name, value, holidays, holiday_kinds, holiday_cell) "
                         "values ('שניים', 4, '{sukkot,pesach}', '{eve}', true)")
        raise psycopg.Rollback()


def test_load_roles_settings(conn):
    with conn.transaction():
        conn.execute("insert into load_roles (name, factor) values ('כונן מבצעי בדיקה', 0.7)")
        rid = conn.execute("select id from load_roles where name = 'כונן מבצעי בדיקה'").fetchone()[0]
        conn.execute("update load_roles set factor = 0.6 where id = %s", (rid,))
        hist = [float(r[0]) for r in conn.execute("select factor from load_role_factor_history where load_role_id = %s order by id", (rid,))]
        assert hist == [0.7, 0.6]
        sid = conn.execute("select id from soldiers where is_active limit 1").fetchone()[0]
        conn.execute("insert into soldier_load_roles (soldier_id, load_role_id, valid_from) values (%s, %s, '2020-01-01')", (sid, rid))
        with pytest.raises(psycopg.Error, match="עובדים"):
            _as_coord(conn, "select public.delete_load_role(%s)", rid)
        raise psycopg.Rollback()


def test_delete_custom_day_type(conn):
    with conn.transaction():
        conn.execute("insert into day_types (code, name) values ('custom_x1', 'ראש'), ('custom_x2', 'כוננות')")
        conn.execute("insert into score_multipliers (name, value, day_types) values ('רק כוננות', 1.5, '{custom_x2}')")
        _as_coord(conn, "select public.delete_day_type('custom_x1')")
        assert conn.execute("select count(*) from day_types where code = 'custom_x1'").fetchone()[0] == 0
        with pytest.raises(psycopg.Error, match="רק לפי"):
            _as_coord(conn, "select public.delete_day_type('custom_x2')")
        with pytest.raises(psycopg.Error, match="המובנים"):
            _as_coord(conn, "select public.delete_day_type('holiday')")
        raise psycopg.Rollback()


def test_tash7_is_an_exemption_type(conn):
    with conn.transaction():
        conn.execute("insert into exemption_types (name, home_nightly) values ('ת\"ש 7 בדיקה', true)")
        tid = conn.execute("select id from exemption_types where name = 'ת\"ש 7 בדיקה'").fetchone()[0]
        sid = conn.execute("select id from soldiers where is_active and not home_nightly limit 1").fetchone()[0]
        conn.execute("""insert into exemptions (soldier_id, exemption_type_id, kind, start_date, end_date, status, proof_checked_at)
                        values (%s, %s, 'full', '2020-01-01', '2099-01-01', 'approved', now())""", (sid, tid))
        kind, hours, scope = conn.execute("select kind, restricted_hours, excluded_task_type_ids from exemptions where soldier_id = %s and exemption_type_id = %s", (sid, tid)).fetchone()
        assert kind == "partial" and hours == "22:00-06:00" and scope is None
        assert conn.execute("select app.home_nightly_on(s, current_date) from soldiers s where id = %s", (sid,)).fetchone()[0]
def test_exemption_after_publish_activates_the_reserve(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        conn.execute("update cycles set status = 'published', published_at = now() where id = %s", (cycle,))
        tid = conn.execute("select task_type_id from slots where cycle_id = %s limit 1", (cycle,)).fetchone()[0]
        a, b, c = [r[0] for r in conn.execute("select id from soldiers where is_active order by id desc limit 3").fetchall()]
        k = conn.execute("insert into slots (cycle_id, task_type_id, starts_at, ends_at) values "
                         "(%s, %s, now() + interval '10 days', now() + interval '11 days') returning id", (cycle, tid)).fetchone()[0]
        p = conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status) select %s, id, gaf_id, 'performer', 'assigned' from soldiers where id = %s returning id", (k, a)).fetchone()[0]
        r = conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status, paired_assignment_id) select %s, id, gaf_id, 'reserve', 'reserve_idle', %s from soldiers where id = %s returning id", (k, p, b)).fetchone()[0]
        k2 = conn.execute("insert into slots (cycle_id, task_type_id, starts_at, ends_at) values "
                          "(%s, %s, now() + interval '12 days', now() + interval '13 days') returning id", (cycle, tid)).fetchone()[0]
        r2 = conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status) select %s, id, gaf_id, 'reserve', 'reserve_idle' from soldiers where id = %s returning id", (k2, a)).fetchone()[0]
        etype = conn.execute("select id from exemption_types where not qualifies_day_only limit 1").fetchone()[0]
        conn.execute("delete from exemption_type_duties where exemption_type_id = %s", (etype,))
        conn.execute("""insert into exemptions (soldier_id, exemption_type_id, kind, start_date, end_date, status, proof_checked_at)
                        values (%s, %s, 'full', current_date, current_date + 20, 'approved', now())""", (a, etype))
        assert conn.execute("select status from assignments where id = %s", (p,)).fetchone()[0] == "dropped"
        st, pts = conn.execute("select status, points from assignments where id = %s", (r,)).fetchone()
        assert st == "reserve_activated" and pts > 0
        assert conn.execute("select status from assignments where id = %s", (r2,)).fetchone()[0] == "dropped"
        raise psycopg.Rollback()


def test_cycle_stage_follows_the_data(conn):
    cycle = conn.cycle_id
    auto = lambda: conn.execute("select app.cycle_auto_status(c) from cycles c where id = %s", (cycle,)).fetchone()[0]
    with conn.transaction():
        conn.execute("update cycles set status = 'draft', exemption_deadline = now() + interval '3 days', potential_computed_at = null where id = %s", (cycle,))
        conn.execute("delete from roster_imports where kind = 'roster'")
        assert auto() == "loading"
        conn.execute("insert into roster_imports (kind, status) values ('roster', 'applied')")
        assert auto() == "collecting"
        conn.execute("update cycles set exemption_deadline = now() - interval '1 hour' where id = %s", (cycle,))
        conn.execute("update exemptions set status = 'approved', proof_checked_at = now() where status = 'pending'")
        assert auto() == "potential"
        conn.execute("update cycles set potential_computed_at = now() where id = %s", (cycle,))
        assert auto() == "slots"
        stages = _as_coord(conn, "select stage, tone from public.cycle_stages(%s)", cycle)
        assert len(stages) == 10 and dict(stages)["loading"] == "done"
        n = _as_coord(conn, "select public.refresh_cycle_stages()")[0][0]
        assert n >= 1 and conn.execute("select status from cycles where id = %s", (cycle,)).fetchone()[0] == "slots"
        raise psycopg.Rollback()


def test_new_soldier_opens_at_group_average(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        conn.execute("insert into roster_imports (kind, status, created_at) values ('roster', 'applied', now() - interval '30 days')")
        peer = conn.execute(
            "select s.id, s.service_type, s.gaf_id, s.computed_rank_id from soldiers s where s.is_active and s.is_shachar = false "
            "and s.release_date is null order by s.full_name limit 1").fetchone()
        new = conn.execute(
            """insert into soldiers (soldier_key, full_name, service_type, gaf_id, computed_rank_id)
               values (repeat('a', 64), 'חייל חדש', %s, %s, %s) returning id""", peer[1:]).fetchone()[0]
        conn.execute("select public.snapshot_cycle(%s)", (cycle,))
        group = conn.execute("select fairness_group from cycle_soldier_snapshot where cycle_id = %s and soldier_id = %s",
                             (cycle, new)).fetchone()[0]
        mean = conn.execute(
            "select round(avg(baseline_score), 2) from cycle_soldier_snapshot where cycle_id = %s and fairness_group = %s and soldier_id <> %s",
            (cycle, group, new)).fetchone()[0]
        opening, at = conn.execute("select opening_score, opening_score_at from soldiers where id = %s", (new,)).fetchone()
        assert at is not None and opening == mean
        base = conn.execute("select baseline_score from cycle_soldier_snapshot where cycle_id = %s and soldier_id = %s",
                            (cycle, new)).fetchone()[0]
        assert base == opening
        # a second snapshot keeps the same opening, and old soldiers get none
        conn.execute("select public.snapshot_cycle(%s)", (cycle,))
        assert conn.execute("select opening_score from soldiers where id = %s", (new,)).fetchone()[0] == opening
        assert conn.execute("select count(*) from soldiers where opening_score_at > now() - interval '2 hours' and id <> %s",
                            (new,)).fetchone()[0] == 0
        # dated at the cycle's start (inside its window), and he joins the unit with the cycle
        start = conn.execute("select start_date from cycles where id = %s", (cycle,)).fetchone()[0]
        at, joined = conn.execute("select (opening_score_at at time zone 'Asia/Jerusalem')::date, unit_join_date from soldiers where id = %s",
                                  (new,)).fetchone()
        assert at == start and joined == max(start, date.today())
        raise psycopg.Rollback()


def test_rekey_moves_soldiers_to_the_new_key(conn):
    with conn.transaction():
        a, b = [r[0] for r in conn.execute("select id from soldiers order by full_name limit 2").fetchall()]
        pairs = json.dumps([{"id": str(a), "key": "1" * 64}, {"id": str(b), "key": "2" * 64}])
        n = _as_coord(conn, "select public.rekey_soldiers(%s::jsonb, %s)", pairs, "f" * 64)
        assert n[0][0] == 2
        assert conn.execute("select soldier_key from soldiers where id = %s", (a,)).fetchone()[0] == "1" * 64
        assert conn.execute("select value #>> '{}' from settings where key = 'unit_key_check'").fetchone()[0] == "f" * 64
        raise psycopg.Rollback()
    with conn.transaction():
        a = conn.execute("select id from soldiers limit 1").fetchone()[0]
        twice = json.dumps([{"id": str(a), "key": "1" * 64}, {"id": str(a), "key": "2" * 64}])
        with pytest.raises(psycopg.errors.RaiseException):
            _as_coord(conn, "select public.rekey_soldiers(%s::jsonb, %s)", twice, "f" * 64)
        raise psycopg.Rollback()
    with pytest.raises(psycopg.Error):
        with session_as(conn, VIEWER) as c:
            c.execute("select public.rekey_soldiers('[]'::jsonb, %s)", ("f" * 64,))


def test_undo_reserve_activation_before_the_duty(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        conn.execute("update cycles set status = 'published', published_at = now() where id = %s", (cycle,))
        tid = conn.execute("select task_type_id from slots where cycle_id = %s limit 1", (cycle,)).fetchone()[0]
        a, b = [r[0] for r in conn.execute("select id from soldiers where is_active order by id limit 2").fetchall()]
        conn.execute("delete from exemptions where soldier_id = %s", (a,))
        k = conn.execute("insert into slots (cycle_id, task_type_id, starts_at, ends_at) values "
                         "(%s, %s, now() + interval '30 days', now() + interval '31 days') returning id", (cycle, tid)).fetchone()[0]
        p = conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status) select %s, id, gaf_id, 'performer', 'assigned' from soldiers where id = %s returning id", (k, a)).fetchone()[0]
        r = conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status) select %s, id, gaf_id, 'reserve', 'reserve_idle' from soldiers where id = %s returning id", (k, b)).fetchone()[0]
        _as_coord(conn, "select public.activate_reserve(%s)", r)
        names = conn.execute("select full_name from soldiers where id in (%s, %s) order by id = %s desc", (a, b, a)).fetchall()
        board = conn.execute("select activated, replaced from published_board where slot_id = %s", (k,)).fetchone()
        assert board is None or (board[0] == [names[1][0]] and board[1] == [names[0][0]])
        _as_coord(conn, "select public.undo_reserve_activation(%s)", r)
        sp, pp = conn.execute("select status, points from assignments where id = %s", (p,)).fetchone()
        sr, rep = conn.execute("select status, replaced_assignment_id from assignments where id = %s", (r,)).fetchone()
        assert sp == "assigned" and float(pp) > 0 and sr == "reserve_idle" and rep is None
        # a duty that has started cannot be undone
        conn.execute("update slots set starts_at = now() - interval '1 hour' where id = %s", (k,))
        _as_coord(conn, "select public.activate_reserve(%s)", r)
        with pytest.raises(psycopg.Error):
            _as_coord(conn, "select public.undo_reserve_activation(%s)", r)
        raise psycopg.Rollback()


def test_delete_pending_slot_only_without_published_people(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        tid = conn.execute("select task_type_id from slots where cycle_id = %s limit 1", (cycle,)).fetchone()[0]
        a = conn.execute("select id from soldiers where is_active limit 1").fetchone()[0]
        k = conn.execute("insert into slots (cycle_id, task_type_id, starts_at, ends_at) values "
                         "(%s, %s, now() + interval '30 days', now() + interval '31 days') returning id", (cycle, tid)).fetchone()[0]
        conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status) select %s, id, gaf_id, 'performer', 'draft' from soldiers where id = %s", (k, a))
        _as_coord(conn, "select public.delete_pending_slot(%s)", k)
        assert conn.execute("select count(*) from slots where id = %s", (k,)).fetchone()[0] == 0
        k2 = conn.execute("insert into slots (cycle_id, task_type_id, starts_at, ends_at) values "
                          "(%s, %s, now() + interval '30 days', now() + interval '31 days') returning id", (cycle, tid)).fetchone()[0]
        conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status) select %s, id, gaf_id, 'performer', 'assigned' from soldiers where id = %s", (k2, a))
        with pytest.raises(psycopg.Error):
            _as_coord(conn, "select public.delete_pending_slot(%s)", k2)
        raise psycopg.Rollback()


def test_assign_published_staffs_a_waiting_duty(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        conn.execute("update cycles set status = 'published', published_at = now() where id = %s", (cycle,))
        tid = conn.execute("select task_type_id from slots where cycle_id = %s limit 1", (cycle,)).fetchone()[0]
        k = conn.execute("insert into slots (cycle_id, task_type_id, starts_at, ends_at) values "
                         "(%s, %s, now() + interval '30 days', now() + interval '31 days') returning id", (cycle, tid)).fetchone()[0]
        # soldiers free at those hours (two duties at once are refused)
        a, b, c = [r[0] for r in conn.execute(
            "select so.id from soldiers so where so.is_active and not exists (select 1 from assignments x join slots y on y.id = x.slot_id "
            "where x.soldier_id = so.id and y.id <> %s and y.starts_at < now() + interval '31 days' and y.ends_at > now() + interval '30 days' "
            "and x.status not in ('dropped', 'cancelled_approved', 'swapped_out')) order by so.id limit 3", (k,)).fetchall()]
        conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status) select %s, id, gaf_id, 'performer', 'draft' from soldiers where id = %s", (k, c))
        p = _as_coord(conn, "select public.assign_published(%s, 'performer', %s, null)", k, a)[0][0]
        st, src = conn.execute("select status, source from assignments where id = %s", (p,)).fetchone()
        assert st == "assigned" and src == "manual"
        assert conn.execute("select count(*) from assignments where slot_id = %s and status = 'draft' and role = 'performer'", (k,)).fetchone()[0] == 0
        r = _as_coord(conn, "select public.assign_published(%s, 'reserve', %s, 'אין אחר')", k, b)[0][0]
        assert conn.execute("select status, paired_assignment_id from assignments where id = %s", (r,)).fetchone() == ("reserve_idle", p)
        with pytest.raises(psycopg.Error):  # performer already staffed
            _as_coord(conn, "select public.assign_published(%s, 'performer', %s, null)", k, c)
        # take him off to put someone else on: a reason is required, the row stays as dropped
        with pytest.raises(psycopg.Error):
            _as_coord(conn, "select public.unassign_published(%s, ' ')", p)
        _as_coord(conn, "select public.unassign_published(%s, 'לא יכול')", p)
        assert conn.execute("select status, manual_reason from assignments where id = %s", (p,)).fetchone() == ("dropped", "לא יכול")
        assert conn.execute("select paired_assignment_id from assignments where id = %s", (r,)).fetchone()[0] is None
        # the engine is not to propose him for this duty again
        ex = conn.execute("select public.build_solver_input(%s, 'stability')", (cycle,)).fetchone()[0]["excluded"]
        assert {"slot_id": str(k), "soldier_id": str(a)} in ex
        p2 = _as_coord(conn, "select public.assign_published(%s, 'performer', %s, null)", k, c)[0][0]
        assert conn.execute("select status from assignments where id = %s", (p2,)).fetchone()[0] == "assigned"
        raise psycopg.Rollback()


def test_new_run_saves_when_a_manual_reserve_points_at_an_old_engine_performer(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        conn.execute("update cycles set status = 'review' where id = %s", (cycle,))
        k = conn.execute("select id from slots where cycle_id = %s order by starts_at limit 1", (cycle,)).fetchone()[0]
        conn.execute("delete from assignments where slot_id = %s", (k,))
        # soldiers free at the slot's hours (two duties at once are refused)
        a, b = [r[0] for r in conn.execute(
            "select so.id from soldiers so, slots k where k.id = %s and so.is_active and not exists (select 1 from assignments x join slots y on y.id = x.slot_id "
            "where x.soldier_id = so.id and y.starts_at < k.ends_at and y.ends_at > k.starts_at "
            "and x.status not in ('dropped', 'cancelled_approved', 'swapped_out')) order by so.id limit 2", (k,)).fetchall()]
        p = conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status, source) select %s, id, gaf_id, 'performer', 'draft', 'solver' from soldiers where id = %s returning id", (k, a)).fetchone()[0]
        conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status, source, manual_reason, paired_assignment_id) select %s, id, gaf_id, 'reserve', 'draft', 'manual', 'בדיקה', %s from soldiers where id = %s", (k, p, b))
        job = conn.execute("insert into schedule_jobs (cycle_id, kind, input, status) values (%s, 'full', '{}'::jsonb, 'running') returning id", (cycle,)).fetchone()[0]
        result = json.dumps({"status": "FEASIBLE", "assignments": [{"slot_id": str(k), "soldier_id": str(a), "role": "performer", "points": 1, "normalized_points": 1, "explanation": "x"}]})
        _as_coord(conn, "select public.apply_solver_result(%s, %s::jsonb)", job, result)
        res_pair = conn.execute("select paired_assignment_id from assignments where slot_id = %s and role = 'reserve'", (k,)).fetchone()[0]
        new_p = conn.execute("select id from assignments where slot_id = %s and role = 'performer'", (k,)).fetchone()[0]
        assert res_pair == new_p
        raise psycopg.Rollback()


def test_history_counts_published_board(conn):
    """The score before a cycle counts the duties left on earlier published boards, not only 'done'."""
    cycle = conn.cycle_id
    with conn.transaction():
        start = conn.execute("select start_date from cycles where id = %s", (cycle,)).fetchone()[0]
        prev = conn.execute(
            "insert into cycles (name, start_date, end_date, status) values ('קודם', %s, %s, 'published') returning id",
            (start - timedelta(days=60), start - timedelta(days=1))).fetchone()[0]
        task = conn.execute("select id from task_types order by code limit 1").fetchone()[0]
        sol = conn.execute("select id from soldiers where is_active and release_date is null order by full_name limit 1").fetchone()[0]
        conn.execute("select public.snapshot_cycle(%s)", (cycle,))
        before = conn.execute("select baseline_score from cycle_soldier_snapshot where cycle_id = %s and soldier_id = %s",
                              (cycle, sol)).fetchone()[0]

        def duty(days_before, role, status, pts):
            k = conn.execute(
                """insert into slots (cycle_id, task_type_id, starts_at, ends_at)
                   values (%s, %s, (%s::timestamp at time zone 'Asia/Jerusalem'), (%s::timestamp at time zone 'Asia/Jerusalem') + interval '1 day')
                   returning id""", (prev, task, start - timedelta(days=days_before), start - timedelta(days=days_before))).fetchone()[0]
            conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status, points, normalized_points) "
                         "select %s, id, gaf_id, %s, %s, %s, %s from soldiers where id = %s", (k, role, status, pts, pts, sol))

        duty(30, "performer", "assigned", 5)   # on the board, not yet marked done
        duty(20, "performer", "done", 2)
        duty(10, "performer", "dropped", 7)    # left the board
        duty(5, "reserve", "reserve_idle", 0)
        conn.execute("select public.snapshot_cycle(%s)", (cycle,))
        after = conn.execute("select baseline_score from cycle_soldier_snapshot where cycle_id = %s and soldier_id = %s",
                             (cycle, sol)).fetchone()[0]
        assert after - before == 7
        raise psycopg.Rollback()


def test_duty_whose_weight_includes_holidays_gets_no_holiday_multiplier(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        start = conn.execute("select start_date from cycles where id = %s", (cycle,)).fetchone()[0]
        day = start + timedelta(days=3)
        conn.execute("insert into calendar_days (day, day_type, source, note, holiday, holiday_kind) values (%s, 'observance', 'manual', 'חנוכה', 'hanukkah', 'day') "
                     "on conflict (day) do update set day_type = 'observance', holiday = 'hanukkah', holiday_kind = 'day'", (day,))
        conn.execute("update score_multipliers set is_active = false")
        conn.execute("insert into score_multipliers (name, value, holidays, holiday_kinds) values ('חנוכה', 3, '{hanukkah}', '{day}')")
        task, weight = conn.execute("select id, weight from task_types where not is_weekend_type order by code limit 1").fetchone()
        sol = conn.execute("select id from soldiers where is_active order by full_name limit 1").fetchone()[0]
        k = conn.execute(
            """insert into slots (cycle_id, task_type_id, starts_at, ends_at) values
               (%s, %s, (%s::timestamp at time zone 'Asia/Jerusalem') + interval '10 hours', (%s::timestamp at time zone 'Asia/Jerusalem') + interval '20 hours')
               returning id""", (cycle, task, day, day)).fetchone()[0]
        pts = lambda: conn.execute("select raw from app.slot_points(%s, %s)", (k, sol)).fetchone()[0]  # noqa: E731
        assert pts() == weight + 3  # a holiday adds its value
        conn.execute("update task_types set includes_holidays = true where id = %s", (task,))
        assert pts() == weight
        doc = conn.execute("select public.build_solver_input(%s)", (cycle,)).fetchone()[0]
        assert any(t["includes_holidays"] for t in doc["task_types"])
        raise psycopg.Rollback()


def test_update_run_starts_from_the_draft(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        k = conn.execute("select id from slots where cycle_id = %s and cancelled_at is null order by starts_at limit 1", (cycle,)).fetchone()[0]
        sol = conn.execute("select id, gaf_id from soldiers where is_active order by full_name limit 1").fetchone()
        conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status, source) values (%s, %s, %s, 'performer', 'draft', 'solver')",
                     (k, sol[0], sol[1]))
        doc = conn.execute("select public.build_solver_input(%s, 'update')", (cycle,)).fetchone()[0]
        assert {"slot_id": str(k), "soldier_id": str(sol[0]), "role": "performer"} in doc["start"]
        assert conn.execute("select public.build_solver_input(%s, 'full')", (cycle,)).fetchone()[0]["start"] == []
        raise psycopg.Rollback()


def test_special_callup_points_and_name(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        tt = conn.execute("insert into task_types (code, name, weight, service_restriction, is_special) values ('special_any', 'הקפצה מיוחדת', 1, 'any', true) on conflict (code) do update set is_special = true returning id").fetchone()[0]
        start = conn.execute("select start_date from cycles where id = %s", (cycle,)).fetchone()[0]
        day = start + timedelta(days=4)
        k = conn.execute(
            """insert into slots (cycle_id, task_type_id, starts_at, ends_at, performers_needed, reserves_needed, special_name, fixed_points)
               values (%s, %s, (%s::timestamp at time zone 'Asia/Jerusalem') + interval '10 hours',
                       (%s::timestamp at time zone 'Asia/Jerusalem') + interval '2 days 18 hours', 1, 0, 'ליווי משלחת', 4) returning id""",
            (cycle, tt, day, day)).fetchone()[0]
        # a soldier free at those hours (two duties at once are refused)
        sol = conn.execute(
            "select so.id, so.gaf_id from soldiers so, slots k where k.id = %s and so.is_active and not exists ("
            "select 1 from assignments x join slots y on y.id = x.slot_id where x.soldier_id = so.id "
            "and y.starts_at < k.ends_at and y.ends_at > k.starts_at and x.status not in ('dropped', 'cancelled_approved', 'swapped_out')) "
            "order by so.full_name limit 1", (k,)).fetchone()
        # 4 points for the whole duty, though it spans three days
        assert conn.execute("select raw from app.slot_points(%s, %s)", (k, sol[0])).fetchone()[0] == 4
        conn.execute("select public.snapshot_cycle(%s)", (cycle,))
        doc = conn.execute("select public.build_solver_input(%s)", (cycle,)).fetchone()[0]
        assert next(s for s in doc["slots"] if s["id"] == str(k))["fixed_points"] == 4
        conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status, source, manual_reason, points, normalized_points) values (%s, %s, %s, 'performer', 'draft', 'manual', 'בדיקה', 4, 4)",
                     (k, sol[0], sol[1]))
        assert conn.execute("select points from assignments where slot_id = %s", (k,)).fetchone()[0] == 4
        raise psycopg.Rollback()


def test_update_special_slot_rescores(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        tt = conn.execute("insert into task_types (code, name, weight, service_restriction, is_special) values ('special_any', 'הקפצה מיוחדת', 1, 'any', true) on conflict (code) do update set is_special = true returning id").fetchone()[0]
        k = conn.execute(
            """insert into slots (cycle_id, task_type_id, starts_at, ends_at, performers_needed, reserves_needed, special_name, fixed_points)
               values (%s, %s, now() + interval '2 days', now() + interval '2 days 8 hours', 1, 0, 'משימה', 4) returning id""",
            (cycle, tt)).fetchone()[0]
        sol = conn.execute(
            "select so.id, so.gaf_id from soldiers so, slots k where k.id = %s and so.is_active and not exists ("
            "select 1 from assignments x join slots y on y.id = x.slot_id where x.soldier_id = so.id "
            "and y.starts_at < k.ends_at and y.ends_at > k.starts_at and x.status not in ('dropped', 'cancelled_approved', 'swapped_out')) "
            "order by so.full_name limit 1", (k,)).fetchone()
        conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status, source, manual_reason, points, normalized_points) values (%s, %s, %s, 'performer', 'draft', 'manual', 'בדיקה', 4, 4)",
                     (k, sol[0], sol[1]))
        with session_as(conn, COORD):
            conn.execute("select public.update_special_slot(%s, 'משימה חדשה', 6)", (k,))
            assert conn.execute("select special_name, fixed_points from slots where id = %s", (k,)).fetchone() == ("משימה חדשה", 6)
            assert conn.execute("select points from assignments where slot_id = %s", (k,)).fetchone()[0] == 6
        raise psycopg.Rollback()


def test_a_duty_added_by_hand_starts_inside_its_cycle(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        start = conn.execute("select start_date from cycles where id = %s", (cycle,)).fetchone()[0]
        task = conn.execute("select id from task_types order by code limit 1").fetchone()[0]
        with session_as(conn, COORD):
            with pytest.raises(psycopg.errors.RaiseException, match="מחוץ למחזור"):
                with conn.transaction():
                    conn.execute("insert into slots (cycle_id, task_type_id, starts_at, ends_at) values (%s, %s, %s::date - 30, %s::date - 29)",
                                 (cycle, task, start, start))
            conn.execute("insert into slots (cycle_id, task_type_id, starts_at, ends_at) values (%s, %s, (%s::date + 1)::timestamp at time zone 'Asia/Jerusalem', (%s::date + 2)::timestamp at time zone 'Asia/Jerusalem')",
                         (cycle, task, start, start))
        raise psycopg.Rollback()


def test_delete_slot_with_published_people_before_it_starts(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        tid = conn.execute("select task_type_id from slots where cycle_id = %s limit 1", (cycle,)).fetchone()[0]
        a = conn.execute("select id from soldiers where is_active limit 1").fetchone()[0]
        k = conn.execute("insert into slots (cycle_id, task_type_id, starts_at, ends_at) values "
                         "(%s, %s, now() + interval '1 day', now() + interval '2 days') returning id", (cycle, tid)).fetchone()[0]
        conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status) select %s, id, gaf_id, 'performer', 'assigned' from soldiers where id = %s", (k, a))
        with session_as(conn, COORD):
            with pytest.raises(psycopg.Error, match="סיבה"):
                with conn.transaction():
                    conn.execute("select public.delete_slot(%s, null)", (k,))
        raise psycopg.Rollback()


def test_delete_slot_logs_and_removes(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        tid = conn.execute("select task_type_id from slots where cycle_id = %s limit 1", (cycle,)).fetchone()[0]
        a = conn.execute("select id from soldiers where is_active limit 1").fetchone()[0]
        k = conn.execute("insert into slots (cycle_id, task_type_id, starts_at, ends_at) values "
                         "(%s, %s, now() + interval '1 day', now() + interval '2 days') returning id", (cycle, tid)).fetchone()[0]
        conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status) select %s, id, gaf_id, 'performer', 'assigned' from soldiers where id = %s", (k, a))
        with session_as(conn, COORD):
            assert conn.execute("select public.delete_slot(%s, 'בוטלה')", (k,)).fetchone()[0] == 1
            assert conn.execute("select count(*) from slots where id = %s", (k,)).fetchone()[0] == 0
            conn.execute("reset role")
            log = conn.execute("select after->>'reason', jsonb_array_length(before->'people') from audit_log where action = 'slot.delete' and entity_id = %s", (str(k),)).fetchone()
            assert log == ("בוטלה", 1)
        old = conn.execute("insert into slots (cycle_id, task_type_id, starts_at, ends_at) values "
                           "(%s, %s, now() - interval '1 hour', now() + interval '2 hours') returning id", (cycle, tid)).fetchone()[0]
        with session_as(conn, COORD):
            with pytest.raises(psycopg.Error, match="כבר התחילה"):
                with conn.transaction():
                    conn.execute("select public.delete_slot(%s, 'x')", (old,))
        raise psycopg.Rollback()


def test_delete_user_removes_or_closes_the_account(conn):
    uid = _as_coord(conn, "select public.create_user(%s, %s, 'gaf_commander', null)", "cmd.del1", "temp-pass-123")[0][0]
    assert _as_coord(conn, "select public.delete_user(%s)", uid)[0][0] == "deleted"
    assert conn.execute("select count(*) from app_users where id = %s", (uid,)).fetchone()[0] == 0
    assert conn.execute("select count(*) from auth.users where id = %s", (uid,)).fetchone()[0] == 0

    # a user whose name is on a record: closed, hidden, name freed
    uid2 = _as_coord(conn, "select public.create_user(%s, %s, 'gaf_commander', null)", "cmd.del2", "temp-pass-123")[0][0]
    conn.execute("update cycles set published_by = %s where id = %s", (uid2, conn.cycle_id))
    conn.commit()
    try:
        assert _as_coord(conn, "select public.delete_user(%s)", uid2)[0][0] == "closed"
        assert conn.execute("select is_locked, deleted_at is not null, username from app_users where id = %s", (uid2,)).fetchone() == (True, True, f"deleted.{str(uid2)[:8]}")
        assert conn.execute("select count(*) from user_roles where user_id = %s", (uid2,)).fetchone()[0] == 0
        assert not any(u == "cmd.del2" for (u,) in _as_coord(conn, "select username from public.list_users()"))
        _as_coord(conn, "select public.create_user(%s, %s, 'gaf_commander', null)", "cmd.del2", "temp-pass-123")  # the name is free again
    finally:
        conn.execute("update cycles set published_by = null where id = %s", (conn.cycle_id,))
        conn.commit()
    with pytest.raises(psycopg.Error, match="שלך"):
        _as_coord(conn, "select public.delete_user(%s)", COORD)
def test_soldier_joins_with_an_invite_code_and_sees_only_his_own(conn):
    me, other = [r[0] for r in conn.execute(
        "select id from soldiers s where is_active and not exists (select 1 from app_users u where u.soldier_id = s.id) order by id desc limit 2").fetchall()]
    (sid, code), = _as_coord(conn, "select * from public.create_soldier_invites(array[%s]::uuid[], 30)", me)
    assert sid == me and len(code) == 11 and code[5] == "-"
    stored = conn.execute("select code_hash from soldier_invites where soldier_id = %s", (me,)).fetchone()[0]
    assert code not in stored and len(stored) == 64  # only a hash is kept
    # a second code revokes the first
    (_, code2), = _as_coord(conn, "select * from public.create_soldier_invites(array[%s]::uuid[], 30)", me)
    cycle = conn.cycle_id
    with conn.transaction():
        conn.execute("set local role anon")
        with pytest.raises(psycopg.Error, match="הקוד לא תקין"):
            with conn.transaction():
                conn.execute("select public.redeem_invite(%s, 'soldier.one', 'secret-pass-1')", (code,))
        assert conn.execute("select public.redeem_invite(%s, 'Soldier.One', 'secret-pass-1')", (code2.lower(),)).fetchone()[0] == "soldier.one"
        with pytest.raises(psycopg.Error, match="כבר נוצל"):
            with conn.transaction():
                conn.execute("select public.redeem_invite(%s, 'soldier.two', 'secret-pass-1')", (code2,))
        conn.execute("reset role")
        uid, must, linked = conn.execute("select id, must_change_password, soldier_id from app_users where username = 'soldier.one'").fetchone()
        assert linked == me and must is False
        assert conn.execute("select array_agg(role::text) from user_roles where user_id = %s", (uid,)).fetchone()[0] == ["soldier"]
        # a published duty of his and one of someone else
        conn.execute("select public.snapshot_cycle(%s)", (cycle,))
        conn.execute("update cycles set status = 'published', published_at = now() where id = %s", (cycle,))
        k1, k2 = [r[0] for r in conn.execute("select id from slots where cycle_id = %s order by starts_at limit 2", (cycle,)).fetchall()]
        conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status, normalized_points, explanation) "
                     "select %s, id, gaf_id, 'performer', 'assigned', 1.5, 'שובץ כי' from soldiers where id = %s", (k1, me))
        conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status) select %s, id, gaf_id, 'performer', 'assigned' from soldiers where id = %s", (k2, other))
        not_mine = {r[0] for r in conn.execute("select id from assignments where soldier_id <> %s", (me,)).fetchall()}
        conn.execute("set local role authenticated")
        _claims(conn, uid, aal="aal1")  # no second factor for soldiers
        duties = conn.execute("select assignment_id, points, explanation from public.my_duties()").fetchall()
        assert (1.5, "שובץ כי") in [(p, e) for _, p, e in duties]
        assert not {a for a, _, _ in duties} & not_mine
        (n, pts, size, mean), = conn.execute("select duties, points, group_size, group_mean from public.my_scores()").fetchall()
        assert n >= 1 and pts >= 1.5 and size >= 1 and mean is not None
        assert conn.execute("select count(*) from soldiers").fetchone()[0] == 0  # no unit data
        assert conn.execute("select count(*) from exemptions").fetchone()[0] == 0
        with pytest.raises(psycopg.Error):
            with conn.transaction():
                conn.execute("select * from public.create_soldier_invites(array[%s]::uuid[], 30)", (other,))
        raise psycopg.Rollback()


def _soldier_account(conn, username):
    """A soldier with his own account (made through an invite code); returns (user id, soldier id)."""
    sid = conn.execute(
        "select id from soldiers s where is_active and not exists (select 1 from app_users u where u.soldier_id = s.id) order by id limit 1").fetchone()[0]
    (_, code), = _as_coord(conn, "select * from public.create_soldier_invites(array[%s]::uuid[], 30)", sid)
    conn.execute("select public.redeem_invite(%s, %s, 'secret-pass-1')", (code, username))
    return conn.execute("select id from app_users where username = %s", (username,)).fetchone()[0], sid


def test_soldier_enters_his_own_constraints_until_the_deadline(conn):
    from datetime import date, timedelta

    uid, sid = _soldier_account(conn, "self.input")
    etype = conn.execute("select id from exemption_types where auto_rule is null order by name limit 1").fetchone()[0]
    atype = conn.execute("select id from absence_types where not requires_approval order by name limit 1").fetchone()[0]
    today = date.today()
    far = today + timedelta(days=800)  # beyond every planned cycle: open
    with session_as(conn, uid, aal="aal1") as c:
        opts = c.execute("select public.my_input_options()").fetchone()[0]
        assert any(t["id"] == str(etype) for t in opts["exemption_types"]) and opts["block_quota_per_month"] >= 1
        eid = c.execute("select public.submit_exemption(%s, %s, %s)", (etype, far, far + timedelta(days=10))).fetchone()[0]
        b1 = c.execute("select public.add_my_date_block(%s)", (far,)).fetchone()[0]
        with pytest.raises(psycopg.Error, match="כבר יש לך חסימה"):
            with c.transaction():
                c.execute("select public.add_my_date_block(%s)", (far + timedelta(days=1),))
        aid = c.execute("select public.add_my_absence(%s, %s, %s)", (atype, far + timedelta(days=40), far + timedelta(days=42))).fetchone()[0]
        mine = c.execute("select public.my_requests()").fetchone()[0]
        assert [e["status"] for e in mine["exemptions"] if e["mine"]] == ["pending"]
        own = lambda k: [x for x in mine[k] if x["mine"]]
        assert len(own("blocks")) == 1 and len(own("absences")) == 1
        c.execute("select public.withdraw_my_exemption(%s)", (eid,))
        c.execute("select public.cancel_my_date_block(%s)", (b1,))
        c.execute("select public.cancel_my_absence(%s)", (aid,))
        mine = c.execute("select public.my_requests()").fetchone()[0]
        assert [e["status"] for e in mine["exemptions"] if e["mine"]] == ["cancelled"] and own("blocks") == [] and own("absences") == []

    # a cycle whose deadline has passed: blocks and absences close, an exemption becomes urgent
    cycle = conn.cycle_id
    with conn.transaction():
        conn.execute("update cycles set exemption_deadline = now() - interval '1 day', status = 'approving', "
                     "start_date = current_date + 5, end_date = current_date + 60 where id = %s", (cycle,))
        day = today + timedelta(days=10)
        conn.execute("set local role authenticated")
        _claims(conn, uid, aal="aal1")
        with pytest.raises(psycopg.Error, match="נסגר"):
            with conn.transaction():
                conn.execute("select public.add_my_date_block(%s)", (day,))
        with pytest.raises(psycopg.Error, match="נסגר"):
            with conn.transaction():
                conn.execute("select public.add_my_absence(%s, %s, %s)", (atype, day, day))
        conn.execute("select public.submit_exemption(%s, %s, %s)", (etype, day, day + timedelta(days=2)))
        reqs = conn.execute("select public.my_requests()").fetchone()[0]["exemptions"]
        assert [e["is_urgent"] for e in reqs if e["mine"] and e["start_date"] == str(day)] == [True]
        raise psycopg.Rollback()

    # not a soldier: no self-entry
    with session_as(conn, COORD) as c:
        with pytest.raises(psycopg.Error, match="רק עובד"):
            c.execute("select public.add_my_date_block(%s)", (far,))


def test_soldier_is_notified_of_his_board_changes_and_decisions(conn):
    from datetime import timedelta

    uid, sid = _soldier_account(conn, "notify.me")
    cycle = conn.cycle_id
    with conn.transaction():
        conn.execute("update cycles set status = 'review', published_at = null where id = %s", (cycle,))
        k1, k2, k3 = [r[0] for r in conn.execute(
            "select id from slots where cycle_id = %s and cancelled_at is null order by starts_at limit 3", (cycle,)).fetchall()]
        # the duties are in the future
        conn.execute("update slots set starts_at = now() + interval '1 day', ends_at = now() + interval '2 days' where id in (%s, %s, %s)", (k1, k2, k3))
        conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status) select %s, id, gaf_id, 'performer', 'draft' from soldiers where id = %s", (k1, sid))
        conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status) select %s, id, gaf_id, 'reserve', 'draft' from soldiers where id = %s", (k2, sid))
        # publishing: one notification, not one per duty
        conn.execute("update assignments set status = case when role = 'performer' then 'assigned'::assignment_status else 'reserve_idle'::assignment_status end "
                     "where soldier_id = %s and status = 'draft'", (sid,))
        conn.execute("update cycles set status = 'published', published_at = now() where id = %s", (cycle,))
        types = lambda: [r[0] for r in conn.execute("select type from notifications where recipient_user_id = %s order by created_at, type", (uid,)).fetchall()]
        assert types() == ["board_published"]
        body = conn.execute("select payload->>'body' from notifications where recipient_user_id = %s", (uid,)).fetchone()[0]
        assert "תורנויות" in body and "עתודות" in body and "הראשונה" in body
        # after publishing: an added duty, an activated reserve, a removed duty
        conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status) select %s, id, gaf_id, 'performer', 'assigned' from soldiers where id = %s", (k3, sid))
        conn.execute("update assignments set status = 'reserve_activated' where slot_id = %s and soldier_id = %s", (k2, sid))
        conn.execute("update assignments set status = 'dropped' where slot_id = %s and soldier_id = %s", (k1, sid))
        assert sorted(types()) == sorted(["board_published", "duty_added", "reserve_activated", "duty_removed"])
        assert conn.execute("select requires_ack from notifications where recipient_user_id = %s and type = 'reserve_activated'", (uid,)).fetchone()[0]
        # the reminder the day before, once
        conn.execute("update slots set starts_at = now() + interval '20 hours', ends_at = now() + interval '44 hours' where id = %s", (k3,))
        assert conn.execute("select app.queue_reminders()").fetchone()[0] >= 1
        n = conn.execute("select app.queue_reminders()").fetchone()[0]
        assert n == 0
        # an exemption decision
        etype = conn.execute("select id from exemption_types where auto_rule is null limit 1").fetchone()[0]
        eid = conn.execute("insert into exemptions (soldier_id, exemption_type_id, kind, start_date, end_date, status, source) "
                           "values (%s, %s, 'full', current_date + 300, current_date + 301, 'pending', 'soldier') returning id", (sid, etype)).fetchone()[0]
        conn.execute("update exemptions set status = 'rejected', decision_reason = 'אין אסמכתא', decided_at = now() where id = %s", (eid,))
        assert "אין אסמכתא" in conn.execute("select payload->>'body' from notifications where recipient_user_id = %s and type = 'exemption_decided'", (uid,)).fetchone()[0]
        # the soldier reads his own, and only his own
        conn.execute("set local role authenticated")
        _claims(conn, uid, aal="aal1")
        mine = conn.execute("select id, title from public.my_notifications()").fetchall()
        assert len(mine) >= 5 and conn.execute("select count(*) from notifications").fetchone()[0] == len(mine)
        conn.execute("select public.mark_notifications_read(null)")
        assert conn.execute("select count(*) from public.my_notifications() where read_at is null").fetchone()[0] == 0
        conn.execute("select public.save_push_subscription('https://push.example/abc', 'p256', 'authkey', 'test')")
        assert conn.execute("select count(*) from push_subscriptions").fetchone()[0] == 1
        raise psycopg.Rollback()


def test_unit_commander_reads_the_unit_and_its_dashboard(conn):
    uid = _as_coord(conn, "select public.create_user('mefaked.yechida', 'temp-pass-123', 'unit_commander', null)")[0][0]
    # a rule change by נע"ת shows on the dashboard
    with conn.transaction():
        conn.execute("set local role authenticated")
        _claims(conn, COORD)
        conn.execute("update settings set value = value where key = (select key from settings order by key limit 1)")
        conn.execute("reset role")
        conn.execute("set local role authenticated")
        _claims(conn, uid)
        assert conn.execute("select count(*) from soldiers").fetchone()[0] > 0
        assert conn.execute("update soldiers set full_name = full_name").rowcount == 0  # reads only
        d = conn.execute("select public.unit_dashboard()").fetchone()[0]
        assert {"cycle", "by_gaf", "by_population", "requests", "accounts", "settings_changes"} <= set(d)
        assert any(x["entity"] == "settings" and x["action"] == "update" for x in d["settings_changes"])
        assert d["accounts"]["soldiers"] > 0
        raise psycopg.Rollback()
    with session_as(conn, uid, aal="aal1") as c:
        with pytest.raises(psycopg.Error):
            c.execute("select public.unit_dashboard()")


def test_highest_value_is_added_once(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        start = conn.execute("select start_date from cycles where id = %s", (cycle,)).fetchone()[0]
        fri = start + timedelta(days=(4 - start.weekday()) % 7)  # the first Friday of the cycle
        conn.execute("insert into calendar_days (day, day_type, source, note, holiday, holiday_kind) values (%s, 'chol_hamoed', 'manual', 'חול המועד', 'pesach', 'chol_hamoed') "
                     "on conflict (day) do update set day_type = 'chol_hamoed', holiday = 'pesach', holiday_kind = 'chol_hamoed'", (fri,))
        conn.execute("update score_multipliers set is_active = false")
        conn.execute("insert into score_multipliers (name, value, weekdays, skip_shabbat_types) values ('סופ״ש בדיקה', 3, '{5,6}', true)")
        conn.execute("insert into score_multipliers (name, value, holidays, holiday_kinds) values ('חוה״מ', 3, '{pesach}', '{chol_hamoed}')")
        task = conn.execute("select id from task_types where not is_weekend_type order by code limit 1").fetchone()[0]
        conn.execute("update task_types set weight = 4, includes_holidays = false where id = %s", (task,))
        sol = conn.execute("select id from soldiers where is_active order by full_name limit 1").fetchone()[0]
        k = conn.execute(
            """insert into slots (cycle_id, task_type_id, starts_at, ends_at) values
               (%s, %s, (%s::timestamp at time zone 'Asia/Jerusalem') - interval '16 hours', (%s::timestamp at time zone 'Asia/Jerusalem') + interval '32 hours')
               returning id""", (cycle, task, fri, fri)).fetchone()[0]  # Thursday 08:00 to Saturday 08:00
        pts = lambda: conn.execute("select raw from app.slot_points(%s, %s)", (k, sol)).fetchone()[0]  # noqa: E731
        assert pts() == 4 + 3  # the higher of the weekend (3) and חול המועד (3), added once
        conn.execute("update score_multipliers set value = 5 where name = 'חוה״מ'")
        assert pts() == 4 + 5
        conn.execute("update slots set is_surprise = true where id = %s", (k,))
        assert pts() == round((4 + 5) * Decimal(str(conn.execute("select app.setting('surprise_multiplier') #>> '{}'").fetchone()[0])), 2)
        raise psycopg.Rollback()


def test_soldiers_hear_about_changes_to_a_published_board(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        conn.execute("update cycles set status = 'published', published_at = now() where id = %s", (cycle,))
        conn.execute("update cycles set start_date = current_date + 10 where id = %s and start_date <= current_date", (cycle,))
        conn.execute("update slots set starts_at = starts_at + interval '400 days', ends_at = ends_at + interval '400 days' where cycle_id = %s and starts_at <= now()", (cycle,))
        tid = conn.execute("select task_type_id from slots where cycle_id = %s limit 1", (cycle,)).fetchone()[0]
        a, b = [r[0] for r in conn.execute("select id from soldiers where is_active order by id desc limit 2").fetchall()]
        users = {}
        for sid, name in ((a, "notify_a"), (b, "notify_b")):
            uid = conn.execute("select app.create_auth_user(%s, 'x-long-password')", (name + "@users.invalid",)).fetchone()[0]
            conn.execute("delete from app_users where soldier_id = %s", (sid,))
            conn.execute("insert into app_users (id, username, soldier_id) values (%s, %s, %s)", (uid, name, sid))
            users[sid] = uid
        got = lambda sid, kind: conn.execute(  # noqa: E731
            "select count(*) from notifications where recipient_user_id = %s and type = %s", (users[sid], kind)).fetchone()[0]

        def duty(days):
            k = conn.execute("insert into slots (cycle_id, task_type_id, starts_at, ends_at) values "
                             "(%s, %s, now() + make_interval(days => %s), now() + make_interval(days => %s + 1)) returning id",
                             (cycle, tid, days, days)).fetchone()[0]
            p = conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status, source, manual_reason) select %s, id, gaf_id, 'performer', 'assigned', 'manual', 'בדיקה' from soldiers where id = %s returning id", (k, a)).fetchone()[0]
            r = conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status, source, manual_reason) select %s, id, gaf_id, 'reserve', 'reserve_idle', 'manual', 'בדיקה' from soldiers where id = %s returning id", (k, b)).fetchone()[0]
            return k, p, r

        # undoing an activation: the performer is back on, the reserve stands by again
        k, p, r = duty(300)
        _as_coord(conn, "select public.activate_reserve(%s)", r)
        _as_coord(conn, "select public.undo_reserve_activation(%s)", r)
        assert got(a, "duty_restored") == 1 and got(b, "activation_undone") == 1
        # deleting a published duty: both hear it is cancelled
        _as_coord(conn, "select public.delete_slot(%s, 'בוטלה')", k)
        assert got(a, "duty_removed") >= 1 and got(b, "duty_removed") >= 1
        # unpublishing: one message each, however many duties
        duty(310)
        duty(320)
        _as_coord(conn, "select public.unpublish_cycle(%s)", cycle)
        assert got(a, "board_withdrawn") == 1 and got(b, "board_withdrawn") == 1


def test_engine_drafts_are_not_audited_row_by_row(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        tid = conn.execute("select task_type_id from slots where cycle_id = %s limit 1", (cycle,)).fetchone()[0]
        a = conn.execute("select id from soldiers where is_active order by id limit 1").fetchone()[0]
        k = conn.execute("insert into slots (cycle_id, task_type_id, starts_at, ends_at) values "
                         "(%s, %s, now() + interval '200 days', now() + interval '201 days') returning id", (cycle, tid)).fetchone()[0]
        count = lambda i: conn.execute("select count(*) from audit_log where entity_type = 'assignments' and entity_id = %s", (str(i),)).fetchone()[0]  # noqa: E731
        d = conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status, source) select %s, id, gaf_id, 'performer', 'draft', 'solver' from soldiers where id = %s returning id", (k, a)).fetchone()[0]
        conn.execute("update assignments set points = 3 where id = %s", (d,))
        assert count(d) == 0  # an engine draft: not recorded
        conn.execute("update assignments set status = 'assigned' where id = %s", (d,))
        assert count(d) == 1  # published: recorded
        conn.execute("delete from assignments where id = %s", (d,))
        assert count(d) == 2
        m = conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status, source, manual_reason) select %s, id, gaf_id, 'performer', 'draft', 'manual', 'בדיקה' from soldiers where id = %s returning id", (k, a)).fetchone()[0]
        assert count(m) == 1  # a manual draft is a decision: recorded
        raise psycopg.Rollback()


def test_solver_role_does_only_the_engines_work(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        job = conn.execute("insert into schedule_jobs (cycle_id, status, input) values (%s, 'queued', '{}') returning id", (cycle,)).fetchone()[0]
        conn.execute("set local role mahan_solver")
        row = conn.execute("select id, input from schedule_jobs where status = 'queued' order by created_at limit 1 for update skip locked").fetchone()
        assert row is not None
        conn.execute("update schedule_jobs set status = 'running', started_at = now(), progress = 1, params = params || '{\"phase\": \"x\"}' where id = %s", (job,))
        for sql in ("select count(*) from soldiers", "select count(*) from app_users", "select count(*) from audit_log",
                    "update schedule_jobs set result = '{}' where id = '%s'" % job):
            conn.execute("savepoint s")
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                conn.execute(sql)
            conn.execute("rollback to savepoint s")
        raise psycopg.Rollback()


def test_solver_role_logged_in_directly_can_report_a_result(conn):
    """The worker connects as mahan_solver (no SET ROLE): apply_solver_result accepts it."""
    cycle = conn.cycle_id
    job = conn.execute("insert into schedule_jobs (cycle_id, status, input) values (%s, 'running', '{}') returning id", (cycle,)).fetchone()[0]
    conn.execute("alter role mahan_solver with login password 'test-only-solver'")
    try:
        base = _db_url(DB)
        rest = base.split("://", 1)[1]
        host_part = rest.split("@", 1)[1] if "@" in rest else rest
        user_url = f"postgresql://mahan_solver:test-only-solver@{host_part}"
        with psycopg.connect(user_url, autocommit=True) as w:
            assert w.execute("select current_setting('role')").fetchone()[0] == "none"
            assert w.execute("select public.apply_solver_result(%s, %s)", (job, Jsonb({"status": "INFEASIBLE"}))).fetchone()[0] == 0
        assert conn.execute("select status from schedule_jobs where id = %s", (job,)).fetchone()[0] == "failed"
    finally:
        conn.execute("alter role mahan_solver with nologin password null")
        conn.execute("delete from schedule_jobs where id = %s", (job,))


def test_call_up_by_notice(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        conn.execute("update cycles set status = 'published', published_at = now() - interval '10 days' where id = %s", (cycle,))
        tid = conn.execute("select task_type_id from slots where cycle_id = %s limit 1", (cycle,)).fetchone()[0]
        m = float(conn.execute("select coalesce((app.setting('surprise_multiplier') #>> '{}')::numeric, 1)").fetchone()[0])
        a, b, c = [r[0] for r in conn.execute("select id from soldiers where is_active and (unit_join_date is null or unit_join_date < current_date - 400) order by id desc limit 3").fetchall()]

        def slot(hours):
            return conn.execute("insert into slots (cycle_id, task_type_id, starts_at, ends_at) values "
                                "(%s, %s, now() + make_interval(hours => %s), now() + make_interval(hours => %s + 24)) returning id",
                                (cycle, tid, hours, hours)).fetchone()[0]

        def put(k, sid, role="performer", status="assigned"):
            return conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status, points, normalized_points, source, manual_reason) "
                                "select %s, id, gaf_id, %s, %s, 4, 4, 'manual', 'בדיקה' from soldiers where id = %s returning id",
                                (k, role, status, sid)).fetchone()[0]

        row = lambda i: conn.execute("select is_surprise, points::float from assignments where id = %s", (i,)).fetchone()  # noqa: E731
        # put on a duty 48 hours ahead: a call-up; 5 days ahead: not
        near = put(slot(48), a)
        assert row(near) == (True, pytest.approx(4 * m))
        far = put(slot(120), b)
        assert row(far) == (False, 4.0)
        # done keeps it; dropped loses it
        conn.execute("update assignments set status = 'done' where id = %s", (near,))
        assert row(near)[0] is True
        # a reserve activated 30 hours ahead: a call-up; the activation undone: gone
        k = slot(30)
        r = put(k, c, "reserve", "reserve_idle")
        assert row(r) == (False, 4.0)
        conn.execute("update assignments set status = 'reserve_activated' where id = %s", (r,))
        assert row(r) == (True, pytest.approx(4 * m))
        conn.execute("update assignments set status = 'reserve_idle', points = 0, normalized_points = 0 where id = %s", (r,))
        assert row(r) == (False, 0.0)
        # recomputing the points keeps the multiplier of a called-up soldier
        raw = float(conn.execute("select raw from app.slot_points(%s, %s)", (conn.execute("select slot_id from assignments where id = %s", (near,)).fetchone()[0], a)).fetchone()[0])
        base = float(conn.execute("select t.weight from task_types t where id = %s", (tid,)).fetchone()[0])
        assert raw >= base * m - 0.01
        # the first publication is never a call-up
        conn.execute("update cycles set status = 'review', published_at = null where id = %s", (cycle,))
        d = conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status, points, normalized_points, source) "
                         "select %s, id, gaf_id, 'performer', 'draft', 4, 4, 'solver' from soldiers where id = %s returning id", (slot(20), b)).fetchone()[0]
        conn.execute("update assignments set status = 'assigned' where id = %s", (d,))
        conn.execute("update cycles set status = 'published', published_at = now() where id = %s", (cycle,))
        assert row(d) == (False, 4.0)
        raise psycopg.Rollback()


def test_coordinator_creates_another_coordinator(conn):
    with session_as(conn, COORD) as c:
        uid = c.execute("select public.create_user('naat.two', 'temp-pass-123', 'coordinator', null)").fetchone()[0]
        c.execute("reset role")
        assert c.execute("select must_change_password from app_users where id = %s", (uid,)).fetchone()[0] is True
        assert [r[0] for r in c.execute("select role from user_roles where user_id = %s", (uid,)).fetchall()] == ["coordinator"]
        # the new one manages users too, after the second factor
        c.execute("set local role authenticated")
        _claims(c, uid)
        assert c.execute("select count(*) from public.list_users()").fetchone()[0] >= 2
        c.execute("select public.set_user_locked(%s, true)", (str(COORD),))  # another coordinator: allowed
        with pytest.raises(psycopg.Error):
            c.execute("select public.set_user_locked(%s, true)", (str(uid),))  # himself: never
    with session_as(conn, COORD) as c:
        with pytest.raises(psycopg.Error):  # still no other roles
            c.execute("select public.create_user('x.admin', 'temp-pass-123', 'soldier', null)")


def test_notify_tick_queues_reminders_and_counts_waiting(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        conn.execute("update cycles set status = 'published', published_at = now() - interval '5 days' where id = %s", (cycle,))
        tid = conn.execute("select task_type_id from slots where cycle_id = %s limit 1", (cycle,)).fetchone()[0]
        sid = conn.execute("select id from soldiers where is_active order by id desc limit 1").fetchone()[0]
        uid = conn.execute("select app.create_auth_user('tick.soldier@users.invalid', 'x-long-password')").fetchone()[0]
        conn.execute("delete from app_users where soldier_id = %s", (sid,))
        conn.execute("insert into app_users (id, username, soldier_id) values (%s, 'tick.soldier', %s)", (uid, sid))
        k = conn.execute("insert into slots (cycle_id, task_type_id, starts_at, ends_at) values "
                         "(%s, %s, now() + interval '20 hours', now() + interval '44 hours') returning id", (cycle, tid)).fetchone()[0]
        conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status, source, manual_reason) "
                     "select %s, id, gaf_id, 'performer', 'assigned', 'manual', 'בדיקה' from soldiers where id = %s", (k, sid))
        first = conn.execute("select app.notify_tick()").fetchone()[0]
        assert first["reminders"] >= 1
        assert conn.execute("select count(*) from notifications where recipient_user_id = %s and type = 'duty_reminder'", (uid,)).fetchone()[0] == 1
        assert conn.execute("select app.notify_tick()").fetchone()[0]["reminders"] == 0  # once only
        # anything not pushed yet, for someone with a phone subscribed, is counted as waiting
        conn.execute("insert into push_subscriptions (user_id, endpoint, p256dh, auth) values (%s, 'https://push.invalid/x', 'k', 'a')", (uid,))
        conn.execute("update notifications set created_at = now() - interval '5 minutes' where recipient_user_id = %s", (uid,))
        assert conn.execute("select app.notify_tick()").fetchone()[0]["waiting"] >= 1
        raise psycopg.Rollback()


def test_gaf_commander_sees_personal_records_of_his_own_gaf_only(conn):
    cycle = conn.cycle_id
    g1, g2 = [r[0] for r in conn.execute(
        "select gaf_id from soldiers where is_active group by gaf_id having count(*) > 0 order by gaf_id limit 2").fetchall()]
    mine = conn.execute("select id from soldiers s where gaf_id = %s and is_active "
                        "and not exists (select 1 from app_users u where u.soldier_id = s.id) order by id limit 1", (g1,)).fetchone()[0]
    other = conn.execute("select id from soldiers where gaf_id = %s and is_active order by id limit 1", (g2,)).fetchone()[0]
    uid = _as_coord(conn, "select public.create_user(%s, %s, 'gaf_commander', %s)", "cmd.scope", "temp-pass-123", mine)[0][0]
    try:
        with conn.transaction():
            for sid in (mine, other):
                conn.execute("insert into absences (soldier_id, absence_type_id, starts_at, ends_at) "
                             "select %s, id, now(), now() + interval '1 day' from absence_types limit 1", (sid,))
            # the generated unit may already hold absences of his (it depends on today's date)
            all_mine = conn.execute("select count(*) from absences where soldier_id = %s", (mine,)).fetchone()[0]
            with session_as(conn, uid) as c:
                gafs = {r[0] for r in c.execute("select distinct gaf_id from soldiers").fetchall()}
                assert gafs == {g1}  # the soldiers table: his gaf only
                assert c.execute("select count(*) from absences where soldier_id = %s", (mine,)).fetchone()[0] == all_mine >= 1
                assert c.execute("select count(*) from absences where soldier_id = %s", (other,)).fetchone()[0] == 0
                # every name, for the draft and the board – without personal details
                names = {r[0] for r in c.execute("select id from public.soldier_directory()").fetchall()}
                assert {mine, other} <= names
                # potential: figures for all, reasons only for his own
                rows = c.execute("select soldier_id, reasons from public.potential_matrix(%s)", (cycle,)).fetchall()
                assert any(s == other for s, _ in rows)
                assert all(r is None for s, r in rows if s == other)
                assert c.execute("select count(*) from notifications where recipient_user_id <> %s", (uid,)).fetchone()[0] == 0
                assert c.execute("select count(*) from roster_imports").fetchone()[0] == 0
            raise psycopg.Rollback()
    finally:
        conn.execute("delete from auth.users where id = %s", (uid,))


def test_mark_invites_sent(conn):
    with session_as(conn, COORD) as c:
        sid = c.execute("select id from soldiers s where is_active and not exists (select 1 from app_users u where u.soldier_id = s.id) order by id limit 1").fetchone()[0]
        c.execute("select * from public.create_soldier_invites(array[%s]::uuid[], 30)", (sid,))
        row = lambda: c.execute("select invite_state, invite_sent_at is not null from public.soldier_account_status() where soldier_id = %s", (sid,)).fetchone()  # noqa: E731
        assert row() == ("open", False)
        assert c.execute("select public.mark_invites_sent(array[%s]::uuid[])", (sid,)).fetchone()[0] == 1
        assert row() == ("open", True)
        assert c.execute("select public.mark_invites_sent(array[%s]::uuid[])", (sid,)).fetchone()[0] == 0  # already sent


def test_soldier_phone_is_checked_scoped_and_masked_in_the_audit(conn):
    sid, gaf = conn.execute("select id, gaf_id from soldiers where is_active order by id limit 1").fetchone()
    other = conn.execute("select id from soldiers where is_active and gaf_id <> %s order by id limit 1", (gaf,)).fetchone()[0]
    with pytest.raises(psycopg.Error, match="check"):
        with conn.transaction():
            conn.execute("update soldiers set phone = '0501234567' where id = %s", (sid,))
    _as_coord(conn, "update soldiers set phone = '972501234567' where id = %s returning id", sid)
    _as_coord(conn, "update soldiers set phone = '972501234599' where id = %s returning id", other)
    conn.commit()
    try:
        before, after = conn.execute(
            "select before ->> 'phone', after ->> 'phone' from audit_log where entity_type = 'soldiers' and entity_id = %s order by id desc limit 1",
            (str(sid),)).fetchone()
        assert before is None and after == "•••67"
        assert not conn.execute("select count(*) from audit_log where after::text like '%%501234567%%' or before::text like '%%501234567%%'").fetchone()[0]
        # a gaf commander reads the phones of his own gaf only; the directory never carries them
        mate = conn.execute(
            "select id from soldiers s where gaf_id = %s and not exists (select 1 from app_users u where u.soldier_id = s.id) order by id desc limit 1",
            (gaf,)).fetchone()[0]
        cmd_id = _as_coord(conn, "select public.create_user(%s, %s, 'gaf_commander', %s)", "cmd.phone", "temp-pass-123", mate)[0][0]
        conn.commit()
        with session_as(conn, cmd_id) as c:
            phones = dict(c.execute("select id, phone from soldiers where phone is not null").fetchall())
            assert phones == {sid: "972501234567"}
            cols = [d.name for d in c.execute("select * from public.soldier_directory() limit 1").description]
            assert "phone" not in cols
    finally:
        conn.execute("update soldiers set phone = null where id in (%s, %s)", (sid, other))
        conn.commit()


def test_swaps_handover_and_mutual_without_approval(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        conn.execute("select public.snapshot_cycle(%s)", (cycle,))
        conn.execute("update cycles set status = 'published', published_at = now() - interval '2 days' where id = %s", (cycle,))
        conn.execute("delete from assignments where slot_id in (select id from slots where cycle_id = %s)", (cycle,))
        tid = conn.execute("select task_type_id from slots where cycle_id = %s group by 1 order by count(*) desc limit 1", (cycle,)).fetchone()[0]
        def slot(hours):
            return conn.execute("insert into slots (cycle_id, task_type_id, starts_at, ends_at) values "
                                "(%s, %s, now() + make_interval(hours => %s), now() + make_interval(hours => %s + 4)) returning id",
                                (cycle, tid, hours, hours)).fetchone()[0]
        k1, k2, k_late = slot(48), slot(240), slot(10)
        ok = lambda k: {r[0] for r in conn.execute(
            "select soldier_id from app.slot_candidates_for(%s) where cardinality(reasons) = 0 and jsonb_array_length(conflicts) = 0", (k,)).fetchall()}
        taken = {r[0] for r in conn.execute("select soldier_id from app_users where soldier_id is not null").fetchall()}
        both = sorted((ok(k1) & ok(k2) & ok(k_late)) - taken)  # soldiers with no account yet
        assert len(both) >= 3
        a_sid, b_sid, c_sid = both[:3]
        users = {}
        for name, sid in (("swap.a", a_sid), ("swap.b", b_sid)):
            uid = conn.execute("select app.create_auth_user(%s, 'x-long-password')", (f"{name}@users.invalid",)).fetchone()[0]
            conn.execute("insert into app_users (id, username, soldier_id) values (%s, %s, %s)", (uid, name, sid))
            conn.execute("insert into user_roles (user_id, role) values (%s, 'soldier')", (uid,))
            users[sid] = uid
        put = lambda k, sid: conn.execute(
            "insert into assignments (slot_id, soldier_id, gaf_id, role, status, source, manual_reason, points, normalized_points) "
            "select %s, id, gaf_id, 'performer', 'assigned', 'manual', 'בדיקה', 1, 1 from soldiers where id = %s returning id", (k, sid)).fetchone()[0]
        a1, a2, late = put(k1, a_sid), put(k2, a_sid), put(k_late, a_sid)
        conn.execute("set local role authenticated")
        _claims(conn, users[a_sid], aal="aal1")
        opts = conn.execute("select public.swap_options(%s)", (a1,)).fetchone()[0]
        names = {o["soldier_id"] for o in opts["handover"]}
        assert str(b_sid) in names and str(c_sid) not in names  # c has no account
        with pytest.raises(psycopg.Error, match="24"):
            with conn.transaction():
                conn.execute("select public.swap_options(%s)", (late,))
        with pytest.raises(psycopg.Error, match="אין חשבון"):
            with conn.transaction():
                conn.execute("select public.request_swap(%s, %s)", (a1, c_sid))
        req = conn.execute("select public.request_swap(%s, %s)", (a1, b_sid)).fetchone()[0]
        with pytest.raises(psycopg.Error, match="כבר יש בקשת"):
            with conn.transaction():
                conn.execute("select public.request_swap(%s, %s)", (a1, b_sid))
        with pytest.raises(psycopg.Error, match="לא נמצאה"):
            with conn.transaction():
                conn.execute("select public.answer_swap(%s, true)", (req,))  # not his to answer
        # the other soldier accepts: done at once
        _claims(conn, users[b_sid], aal="aal1")
        (mine, other), = conn.execute("select mine, other_name from public.my_swaps() where id = %s", (req,)).fetchall()
        assert mine is False and other
        assert conn.execute("select public.answer_swap(%s, true)", (req,)).fetchone()[0]["status"] == "approved"
        conn.execute("reset role")
        rows = conn.execute("select soldier_id, status::text, source::text, is_surprise from assignments where slot_id = %s order by created_at", (k1,)).fetchall()
        assert rows == [(a_sid, "swapped_out", "manual", False), (b_sid, "assigned", "swap", False)]  # 48 hours ahead, yet no call-up
        types = dict(conn.execute("select u.soldier_id, array_agg(n.type order by n.created_at) from notifications n "
                                  "join app_users u on u.id = n.recipient_user_id where u.soldier_id in (%s, %s) group by 1", (a_sid, b_sid)).fetchall())
        assert types[b_sid] == ["swap_request"]  # no "added" on top of the swap
        assert "duty_removed" not in types[a_sid] and types[a_sid][-1] == "swap_done"
        assert conn.execute("select count(*) from notifications n join user_roles ur on ur.user_id = n.recipient_user_id "
                            "where n.type = 'swap_done' and ur.role = 'coordinator'").fetchone()[0] >= 1
        # mutual: B offers k1 back for A's k2
        b1 = conn.execute("select id from assignments where slot_id = %s and soldier_id = %s and status = 'assigned'", (k1, b_sid)).fetchone()[0]
        conn.execute("set local role authenticated")
        _claims(conn, users[b_sid], aal="aal1")
        offers = conn.execute("select public.swap_options(%s)", (b1,)).fetchone()[0]["mutual"]
        assert str(a2) in {o["assignment_id"] for o in offers}
        req2 = conn.execute("select public.request_swap(%s, %s, %s)", (b1, a_sid, a2)).fetchone()[0]
        _claims(conn, users[a_sid], aal="aal1")
        assert conn.execute("select public.answer_swap(%s, true)", (req2,)).fetchone()[0]["status"] == "approved"
        conn.execute("reset role")
        live = set(conn.execute("select slot_id, soldier_id from assignments where slot_id in (%s, %s) and status = 'assigned'", (k1, k2)).fetchall())
        assert live == {(k1, a_sid), (k2, b_sid)}
        # a declined request changes nothing
        a_now = conn.execute("select id from assignments where slot_id = %s and soldier_id = %s and status = 'assigned'", (k1, a_sid)).fetchone()[0]
        conn.execute("set local role authenticated")
        _claims(conn, users[a_sid], aal="aal1")
        req3 = conn.execute("select public.request_swap(%s, %s)", (a_now, b_sid)).fetchone()[0]
        _claims(conn, users[b_sid], aal="aal1")
        assert conn.execute("select public.answer_swap(%s, false)", (req3,)).fetchone()[0]["status"] == "rejected"
        conn.execute("reset role")
        assert conn.execute("select soldier_id from assignments where id = %s and status = 'assigned'", (a_now,)).fetchone()[0] == a_sid
        raise psycopg.Rollback()


def test_scoring_rules_for_soldiers_without_unit_data(conn):
    uid, _ = _soldier_account(conn, "rules.reader")
    conn.commit()
    with session_as(conn, uid, aal="aal1") as c:
        r = c.execute("select public.scoring_rules()").fetchone()[0]
        assert r["tasks"] and all(set(t) == {"name", "weight", "includes_holidays", "weekend_type", "category"} for t in r["tasks"])
        assert r["surprise_notice_hours"] >= 1 and float(r["surprise_multiplier"]) >= 1 and r["window_months"] >= 1 and r["credit_min_days"] >= 1 and isinstance(r["credit_absences"], list)
        assert all(set(a) == {"name", "value"} for a in r["additions"])
        names = {t["name"] for t in r["tasks"]}
        hidden = {n for (n,) in conn.execute("select name from task_types where is_special or not is_active").fetchall()}
        assert not names & hidden
    with session_as(conn, OUTSIDER) as c:
        with pytest.raises(psycopg.Error, match="not allowed"):
            c.execute("select public.scoring_rules()")
    # whatever the settings screen changes shows up here at once – nothing is written into the page
    with conn.transaction():
        tid, tname = conn.execute("select id, name from task_types where is_active and not is_special order by name limit 1").fetchone()
        conn.execute("update task_types set weight = 7.5 where id = %s", (tid,))
        conn.execute("insert into score_multipliers (name, value, weekdays) values ('בדיקה · יום מיוחד', 4.5, '{3}')")
        conn.execute("insert into score_multipliers (name, value, weekdays, is_active) values ('כבויה', 2, '{3}', false)")
        conn.execute("update settings set value = '1.7' where key = 'surprise_multiplier'")
        conn.execute("update settings set value = '48' where key = 'surprise_notice_hours'")
        conn.execute("update absence_types set credits_load = true where name = (select min(name) from absence_types)")
        conn.execute("set local role authenticated")
        _claims(conn, uid, aal="aal1")
        r = conn.execute("select public.scoring_rules()").fetchone()[0]
        assert {t["name"]: float(t["weight"]) for t in r["tasks"]}[tname] == 7.5
        adds = {a["name"]: float(a["value"]) for a in r["additions"]}
        assert adds["בדיקה · יום מיוחד"] == 4.5 and "כבויה" not in adds
        assert float(r["surprise_multiplier"]) == 1.7 and r["surprise_notice_hours"] == 48
        assert r["credit_absences"]


def test_briefing_time_from_the_catalog_rule(conn):
    bt = lambda b, start: conn.execute(
        "select to_char(app.briefing_time(%s, %s::timestamp at time zone app.tz()) at time zone app.tz(), 'YYYY-MM-DD HH24:MI')",
        (Jsonb(b), start)).fetchone()[0]
    tue = {"kind": "briefing", "rule": "weekday", "weekday": 2, "time": "13:00"}
    assert bt(tue, "2026-11-25 08:00") == "2026-11-24 13:00"      # Wednesday: the Tuesday before
    assert bt(tue, "2026-11-24 14:00") == "2026-11-24 13:00"      # Tuesday afternoon: that day
    assert bt(tue, "2026-11-24 08:00") == "2026-11-17 13:00"      # not after the start: a week before
    assert bt({"kind": "report", "rule": "day_before", "time": "09:00"}, "2026-11-25 08:00") == "2026-11-24 09:00"
    assert bt({"kind": "report", "rule": "same_day", "time": "08:30"}, "2026-11-26 08:00") == "2026-11-26 08:30"
    assert conn.execute("select app.briefing_time(%s, now())", (Jsonb({"kind": "by_call"}),)).fetchone()[0] is None
    with pytest.raises(psycopg.errors.CheckViolation):
        with conn.transaction():
            conn.execute("update task_types set briefing = %s where id = (select id from task_types limit 1)",
                         (Jsonb({"kind": "briefing", "rule": "weekday", "time": "13:00"}),))  # no weekday


def test_briefing_reminder_before_an_early_briefing_and_in_the_day_before_reminder(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        conn.execute("update cycles set status = 'published', published_at = now() - interval '5 days' where id = %s", (cycle,))
        tid = conn.execute("select task_type_id from slots where cycle_id = %s limit 1", (cycle,)).fetchone()[0]
        conn.execute("update task_types set briefing = %s where id = %s", (Jsonb({
            "kind": "briefing", "rule": "same_day", "time": "11:00", "place": "טלפוני",
            "contact_name": "אופיר", "contact_phone": "052-0000000", "note": "לא מאושרות החלפות"}), tid))
        sid = conn.execute("select id from soldiers where is_active order by id desc limit 1").fetchone()[0]
        uid = conn.execute("select app.create_auth_user('brief.soldier@users.invalid', 'x-long-password')").fetchone()[0]
        conn.execute("delete from app_users where soldier_id = %s", (sid,))
        conn.execute("insert into app_users (id, username, soldier_id) values (%s, 'brief.soldier', %s)", (uid, sid))

        def duty(start_h, briefing_h=None):
            k = conn.execute("insert into slots (cycle_id, task_type_id, starts_at, ends_at, briefing_at, briefing_place) values "
                             "(%s, %s, now() + make_interval(hours => %s), now() + make_interval(hours => %s + 24), "
                             " now() + make_interval(hours => %s), case when %s::int is not null then 'חדר תדריכים' end) returning id",
                             (cycle, tid, start_h, start_h, briefing_h, briefing_h)).fetchone()[0]
            a = conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status, source, manual_reason, created_at) "
                             "select %s, id, gaf_id, 'performer', 'assigned', 'manual', 'בדיקה', now() - interval '3 days' "
                             "from soldiers where id = %s returning id", (k, sid)).fetchone()[0]
            return k, a

        body = lambda typ, a: conn.execute("select payload->>'body' from notifications where type = %s and payload->>'assignment_id' = %s",
                                           (typ, str(a))).fetchone()
        early_k, early = duty(70, 20)      # a briefing 50 hours before the start, 20 hours from now
        near_k, near = duty(20)            # the catalog's briefing on the day itself
        conn.execute("delete from notifications where recipient_user_id = %s", (uid,))
        conn.execute("select app.queue_reminders()")
        b = body("briefing_reminder", early)[0]
        assert "תדריך" in b and "חדר תדריכים" in b and "אופיר 052-0000000" in b
        assert body("duty_reminder", early) is None                      # the duty itself is 3 days away
        d = body("duty_reminder", near)[0]
        assert "תדריך" in d and "טלפוני" in d and "לא מאושרות החלפות" in d  # merged into the day-before reminder
        assert body("briefing_reminder", near) is None
        assert conn.execute("select app.queue_reminders()").fetchone()[0] == 0   # once only

        # got the duty after the reminder's time: no reminder (the assignment message said it)
        late_k, late = duty(96, 22)
        conn.execute("update assignments set created_at = now() - interval '1 hour' where id = %s", (late,))
        conn.execute("select app.queue_reminders()")
        assert body("briefing_reminder", late) is None

        # the soldier sees the catalog's briefing with the contact; the board without it
        conn.execute("set local role authenticated")
        _claims(conn, uid, aal="aal1")
        row = conn.execute("select briefing_place, contact_name, contact_phone, briefing_note, briefing_at is not null "
                           "from public.my_duties() where assignment_id = %s", (near,)).fetchone()
        assert row == ("טלפוני", "אופיר", "052-0000000", "לא מאושרות החלפות", True)
        conn.execute("reset role")
        raise psycopg.Rollback()


def test_poster_fills_the_catalog_briefings(conn):
    sql = (ROOT / "supabase/migrations/20261118000090_duty_briefings.sql").read_text(encoding="utf-8")
    poster = sql[sql.index("do $$\ndeclare\n  no_swaps"):]
    with conn.transaction():
        cat = lambda n: conn.execute("insert into duty_categories (name) values (%s) on conflict do nothing returning id", (n,)).fetchone()
        for n in ("שמירות חובה", "מפקד שער", "קצין תורן", 'רס"ר'):
            cat(n)
        rows = [("p_mitbach", "מטבח – שבת", None, "any"), ("p_rasar", 'רס"ר הקלת ת"ש', 'רס"ר', "mandatory"),
                ("p_shekem", 'רס"ר', None, "mandatory"), ("p_haganak", 'קצין הגנ"ק', "קצין תורן", "any"),
                ("p_katzin", "קצין תורן – חול", "קצין תורן", "any"), ("p_mamlachat", "ממלכת יום", None, "any"),
                ("p_shag", 'ש"ג – חול', "שמירות חובה", "mandatory"), ("p_shaar", "מפקד שער | ש.ג קבע", "מפקד שער", "any"),
                ("p_keva", "שמירת קבע", None, "career"), ("p_toran", "מפקד תורן", None, "any"),
                ("p_other", "תורנות אחרת", None, "mandatory")]
        for code, name, c, svc in rows:
            conn.execute("update task_types set name = name || ' (קודם)' where name = %s", (name,))
            conn.execute("insert into task_types (code, name, weight, service_restriction, category_id) "
                         "values (%s, %s, 1, %s, (select id from duty_categories where name = %s))", (code, name, svc, c))
        conn.execute("update task_types set briefing = %s where code = 'p_other'", (Jsonb({"kind": "by_call"}),))
        conn.execute("update task_types set briefing = null where code like 'p\\_%%' and code <> 'p_other'")
        conn.execute(poster)
        got = dict(conn.execute("select code, briefing->>'kind' || ' ' || coalesce(briefing->>'time', '') || ' ' || coalesce(briefing->>'place', '') "
                                "from task_types where code like 'p\\_%%'").fetchall())
        assert got == {
            "p_mitbach": 'report 08:30 חד"א חוגרים', "p_rasar": 'report 09:00 מש"ק תורנים', "p_shekem": 'report 08:30 שק"ם',
            "p_haganak": "report 09:00 גף הגנה קרקעית", "p_katzin": 'briefing 09:00 גף רס"ר', "p_mamlachat": "briefing 11:00 טלפוני",
            "p_shag": "briefing 13:00 גף אבטחה פיזית", "p_shaar": "briefing 09:30 גף אבטחה פיזית", "p_keva": "briefing 09:30 גף אבטחה פיזית",
            "p_toran": "by_call  ", "p_other": "by_call  "}   # a type already filled is kept
        raise psycopg.Rollback()


def test_neutral_rank_names_keep_the_military_name_as_alias(conn):
    sql = (ROOT / "supabase/migrations/20261118000091_neutral_rank_names.sql").read_text(encoding="utf-8")
    with conn.transaction():
        before = conn.execute("select id from ranks where name = 'סמל'").fetchone()[0]
        conn.execute(sql)
        row = conn.execute("select name, short_name, aliases, in_duties from ranks where id = %s", (before,)).fetchone()
        assert row[0] == "חובה 3" and row[1] == "חובה 3" and "סמל" in row[2] and row[3] is True
        names = dict(conn.execute("select name, in_duties from ranks where sort_order < 50").fetchall())
        assert names["מקצועי 2"] is False and names["בכיר 1"] is True and names["בכיר 2"] is False
        assert not set(names) & {"טוראי", "סגן", "סרן", 'רס"ן'}
        conn.execute(sql)  # again: nothing left to rename, nothing breaks
        assert conn.execute("select count(*) from ranks where name = 'חובה 3'").fetchone()[0] == 1
        raise psycopg.Rollback()


def test_a_user_keeps_his_look_with_the_account(conn):
    with conn.transaction():
        uid = conn.execute("select app.create_auth_user('theme.user@users.invalid', 'x-long-password')").fetchone()[0]
        conn.execute("insert into app_users (id, username) values (%s, 'theme.user')", (uid,))
        conn.execute("set local role authenticated")
        _claims(conn, uid, aal="aal1")
        conn.execute("select public.set_my_theme('dark')")
        assert conn.execute("select ui_theme from app_users where id = %s", (uid,)).fetchone()[0] == "dark"
        with pytest.raises(psycopg.errors.InvalidParameterValue):
            with conn.transaction():
                conn.execute("select public.set_my_theme('pink')")
        conn.execute("reset role")
        raise psycopg.Rollback()


def test_reset_user_mfa(conn):
    with conn.transaction():
        conn.execute("insert into auth.mfa_factors (user_id) values (%s)", (DEPUTY_ACTIVE,))
        sid = conn.execute("insert into auth.sessions (user_id, aal) values (%s, 'aal2') returning id", (DEPUTY_ACTIVE,)).fetchone()[0]
        conn.execute("insert into auth.refresh_tokens (token, user_id, session_id) values ('t', %s, %s)", (str(DEPUTY_ACTIVE), sid))
        conn.execute("set local role authenticated")
        _claims(conn, COORD)
        has = dict(conn.execute("select user_id, has_mfa from public.list_users()").fetchall())
        assert has[DEPUTY_ACTIVE] is True and has[COORD] is False
        with pytest.raises(psycopg.Error, match="עצמך"):
            with conn.transaction():
                conn.execute("select public.reset_user_mfa(%s)", (COORD,))
        conn.execute("select public.reset_user_mfa(%s)", (DEPUTY_ACTIVE,))
        with pytest.raises(psycopg.Error, match="אין אימות"):
            with conn.transaction():
                conn.execute("select public.reset_user_mfa(%s)", (DEPUTY_ACTIVE,))
        _claims(conn, VIEWER)  # a reader cannot
        with pytest.raises(psycopg.Error, match="רק נע"):
            with conn.transaction():
                conn.execute("select public.reset_user_mfa(%s)", (COORD,))
        conn.execute("reset role")
        for t in ("auth.mfa_factors", "auth.sessions", "auth.refresh_tokens"):
            assert conn.execute(f"select count(*) from {t} where user_id::text = %s", (str(DEPUTY_ACTIVE),)).fetchone()[0] == 0
        assert conn.execute("select count(*) from audit_log where action = 'reset_mfa' and entity_id = %s", (str(DEPUTY_ACTIVE),)).fetchone()[0] == 1
        told = {r[0] for r in conn.execute("select recipient_user_id from notifications where type = 'mfa_reset'").fetchall()}
        assert COORD not in told and DEPUTY_ACTIVE not in told  # neither the one who reset nor the one reset
        raise psycopg.Rollback()


def test_staff_who_do_duties_are_soldiers_too(conn):
    uid, _ = _soldier_account(conn, "promote.me")
    conn.commit()
    with conn.transaction():
        free = [r[0] for r in conn.execute(
            "select id from soldiers s where is_active and not exists (select 1 from app_users u where u.soldier_id = s.id) order by id limit 3").fetchall()]
        conn.execute("set local role authenticated")
        _claims(conn, COORD)
        # a new commander account linked to a soldier holds both roles
        cmd = conn.execute("select public.create_user('both.roles', 'temp-pass-123', 'gaf_commander', %s)", (free[0],)).fetchone()[0]
        roles = lambda u: sorted(r[0] for r in conn.execute("select role::text from user_roles where user_id = %s", (u,)).fetchall())
        assert roles(cmd) == ["gaf_commander", "soldier"]
        with pytest.raises(psycopg.Error, match="כבר יש חשבון"):
            with conn.transaction():
                conn.execute("select public.create_user('second.acct', 'temp-pass-123', 'coordinator', %s)", (free[0],))
        # unlinking drops the soldier role; linking brings it back
        conn.execute("select public.set_user_soldier(%s, null)", (cmd,))
        assert roles(cmd) == ["gaf_commander"]
        conn.execute("select public.set_user_soldier(%s, %s)", (cmd, free[1]))
        assert roles(cmd) == ["gaf_commander", "soldier"]
        # a soldier's own account is promoted instead of opening a second one, and demoted back
        conn.execute("select public.grant_user_role(%s, 'coordinator')", (uid,))
        assert roles(uid) == ["coordinator", "soldier"]
        with pytest.raises(psycopg.Error, match="כבר יש לו"):
            with conn.transaction():
                conn.execute("select public.grant_user_role(%s, 'coordinator')", (uid,))
        with pytest.raises(psycopg.Error, match="שיוך"):
            with conn.transaction():
                conn.execute("select public.revoke_user_role(%s, 'soldier')", (uid,))
        conn.execute("select public.revoke_user_role(%s, 'coordinator')", (uid,))
        assert roles(uid) == ["soldier"]
        with pytest.raises(psycopg.Error, match="אפשר להוסיף"):
            with conn.transaction():
                conn.execute("select public.grant_user_role(%s, 'deputy')", (uid,))  # not offered
        lone = conn.execute("select public.create_user('lone.role', 'temp-pass-123', 'unit_commander')").fetchone()[0]
        with pytest.raises(psycopg.Error, match="היחיד"):
            with conn.transaction():
                conn.execute("select public.revoke_user_role(%s, 'unit_commander')", (lone,))
        with pytest.raises(psycopg.Error, match="מעצמך"):
            with conn.transaction():
                conn.execute("select public.revoke_user_role(%s, 'coordinator')", (COORD,))
        assert conn.execute("select count(*) from audit_log where action in ('grant_role', 'revoke_role') and entity_id = %s", (str(uid),)).fetchone()[0] == 2
        raise psycopg.Rollback()


def test_coordinator_does_not_decide_his_own_exemption(conn):
    with conn.transaction():
        sid = conn.execute("select id from soldiers s where is_active and not exists (select 1 from app_users u where u.soldier_id = s.id) order by id desc limit 1").fetchone()[0]
        conn.execute("update app_users set soldier_id = %s where id = %s", (sid, COORD))
        et = conn.execute("select id from exemption_types order by name limit 1").fetchone()[0]
        ex = conn.execute("insert into exemptions (soldier_id, exemption_type_id, kind, start_date, end_date, status, source) "
                          "values (%s, %s, 'full', current_date, current_date + 30, 'pending', 'soldier') returning id", (sid, et)).fetchone()[0]
        conn.execute("set local role authenticated")
        _claims(conn, COORD)
        with pytest.raises(psycopg.Error, match="בקשה שלך"):
            with conn.transaction():
                conn.execute("update exemptions set status = 'approved', proof_checked_at = now() where id = %s", (ex,))
        _claims(conn, DEPUTY_ACTIVE)
        conn.execute("update exemptions set status = 'approved', proof_checked_at = now() where id = %s", (ex,))
        raise psycopg.Rollback()


def test_add_soldier_by_hand_newcomer_rules(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        conn.execute("select public.snapshot_cycle(%s)", (cycle,))
        if not conn.execute("select 1 from roster_imports where kind = 'roster' and status = 'applied'").fetchone():
            conn.execute("insert into roster_imports (kind, status, summary, created_at) values ('roster', 'applied', '{}', now() - interval '1 day')")
        gaf, rank = conn.execute("select gaf_id, computed_rank_id from soldiers where is_active and service_type = 'mandatory' limit 1").fetchone()
        start = conn.execute("select start_date from cycles where id = %s", (cycle,)).fetchone()[0]
        key = "ab" * 32
        row = {"soldier_key": key, "full_name": "חייל ידני", "service_type": "mandatory", "gaf_id": str(gaf), "rank_id": str(rank),
               "unit_join_date": str(start)}
        conn.execute("set local role authenticated")
        _claims(conn, COORD)
        r = conn.execute("select public.add_soldier(%s)", (json.dumps(row),)).fetchone()[0]
        assert r["status"] == "added"
        sid = r["id"]
        again = conn.execute("select public.add_soldier(%s)", (json.dumps(row),)).fetchone()[0]
        assert again["status"] == "exists" and again["id"] == sid and again["name"] == "חייל ידני"
        conn.execute("reset role")
        # in the cycle under way at once, with an opening score; a grace reason for the engine and the picker
        assert conn.execute("select count(*) from cycle_soldier_snapshot where cycle_id = %s and soldier_id = %s", (cycle, sid)).fetchone()[0] == 1
        assert conn.execute("select opening_score_at is not null from soldiers where id = %s", (sid,)).fetchone()[0]
        assert conn.execute("select value #>> '{}' from settings where key = 'grace_days'").fetchone()[0] == "90"
        slot, sday = conn.execute("select id, starts_at::date from slots where cycle_id = %s and starts_at >= %s::date and starts_at < %s::date + 60 "
                                  "and fixed_points is null and not is_penalty_slot order by starts_at limit 1", (cycle, start, start)).fetchone()
        reasons = conn.execute("select reasons from app.slot_candidates_for(%s, %s)", (slot, sid)).fetchone()[0]
        assert "grace" in reasons
        # assigned by hand in the grace period: a call-up, far ahead or not
        conn.execute("update cycles set status = 'published', published_at = now() - interval '1 day' where id = %s", (cycle,))
        aid = conn.execute("insert into assignments (slot_id, soldier_id, gaf_id, role, status, source, manual_reason, points, normalized_points) "
                           "values (%s, %s, %s, 'performer', 'assigned', 'manual', 'בדיקה', 4, 4) returning id", (slot, sid, gaf)).fetchone()[0]
        assert conn.execute("select is_surprise from assignments where id = %s", (aid,)).fetchone()[0]
        # out of the unit: his duties from that day are dropped, not deleted
        conn.execute("set local role authenticated")
        _claims(conn, COORD)
        assert conn.execute("select public.future_duties(%s, %s)", (sid, sday)).fetchone()[0] == 1
        assert conn.execute("select public.remove_from_unit(%s, %s)", (sid, sday)).fetchone()[0] == 1
        back = conn.execute("select public.add_soldier(%s)", (json.dumps(row),)).fetchone()[0]
        assert back["status"] == "inactive"
        conn.execute("select public.reactivate_soldier(%s)", (sid,))
        conn.execute("reset role")
        assert conn.execute("select status::text from assignments where id = %s", (aid,)).fetchone()[0] == "dropped"
        assert conn.execute("select is_active from soldiers where id = %s", (sid,)).fetchone()[0]
        acts = {a for (a,) in conn.execute("select action from audit_log where entity_id = %s", (str(sid),)).fetchall()}
        assert {"add_soldier", "remove_from_unit", "reactivate_soldier"} <= acts


def test_duty_ack_reminder_and_escalation(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        conn.execute("update cycles set status = 'published', published_at = now() - interval '5 days' where id = %s", (cycle,))
        tid = conn.execute("select task_type_id from slots where cycle_id = %s limit 1", (cycle,)).fetchone()[0]
        slot = lambda h: conn.execute("insert into slots (cycle_id, task_type_id, starts_at, ends_at) values "
                                      "(%s, %s, now() + make_interval(hours => %s), now() + make_interval(hours => %s + 8)) returning id",
                                      (cycle, tid, h, h)).fetchone()[0]
        near, soon, far = slot(20), slot(40), slot(200)
        free = [r[0] for r in conn.execute("select id from soldiers s where is_active and not exists "
                                           "(select 1 from app_users u where u.soldier_id = s.id) order by id limit 2").fetchall()]
        uid = conn.execute("select app.create_auth_user('ack.me@users.invalid', 'x-long-password')").fetchone()[0]
        conn.execute("insert into app_users (id, username, soldier_id) values (%s, 'ack.me', %s)", (uid, free[0]))
        conn.execute("insert into user_roles (user_id, role) values (%s, 'soldier')", (uid,))
        gaf = conn.execute("select gaf_id from soldiers where id = %s", (free[0],)).fetchone()[0]
        cmd = conn.execute("select app.create_auth_user('ack.cmd@users.invalid', 'x-long-password')").fetchone()[0]
        conn.execute("insert into app_users (id, username) values (%s, 'ack.cmd')", (cmd,))
        conn.execute("insert into user_roles (user_id, role, gaf_id) values (%s, 'gaf_commander', %s)", (cmd, gaf))
        put = lambda k, sid: conn.execute(
            "insert into assignments (slot_id, soldier_id, gaf_id, role, status, source, manual_reason, points, normalized_points) "
            "select %s, id, gaf_id, 'performer', 'assigned', 'manual', 'בדיקה', 1, 1 from soldiers where id = %s returning id", (k, sid)).fetchone()[0]
        a_near, a_soon, a_far, b_near = put(near, free[0]), put(soon, free[0]), put(far, free[0]), put(near, free[1])
        # what נע"ת sees: the four within 3 days less the far one
        conn.execute("set local role authenticated")
        _claims(conn, COORD)
        ids = {r[0] for r in conn.execute("select assignment_id from public.unacked_duties(72)").fetchall()}
        assert {a_near, a_soon, b_near} <= ids and a_far not in ids
        conn.execute("select public.staff_ack(%s)", (b_near,))      # spoke on the phone
        # the soldier acknowledges one of his
        _claims(conn, uid, aal="aal1")
        assert conn.execute("select public.ack_duties(%s)", ([a_soon, b_near],)).fetchone()[0] == 1   # not someone else's
        acked = dict(conn.execute("select assignment_id, acked_at is not null from public.my_duties()").fetchall())
        assert acked[a_soon] and not acked[a_near]
        conn.execute("reset role")
        # the tick: a reminder to him for the near one, and his gaf commander hears about it – once
        conn.execute("select app.queue_ack_reminders()")
        conn.execute("select app.queue_ack_reminders()")
        kinds = conn.execute("select n.type, count(*) from notifications n where n.recipient_user_id in (%s, %s) "
                             "and n.type in ('ack_reminder', 'ack_escalation') group by 1 order by 1", (uid, cmd)).fetchall()
        assert kinds == [("ack_escalation", 1), ("ack_reminder", 1)]
        # a new time asks again
        conn.execute("update slots set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' where id = %s", (soon,))
        assert conn.execute("select acked_at from assignments where id = %s", (a_soon,)).fetchone()[0] is None
        raise psycopg.Rollback()


def test_a_released_soldier_cannot_use_the_system(conn):
    uid, sid = _soldier_account(conn, "released.one")
    conn.commit()

    def owner(q):  # app.* functions are not granted to users; ask as the owner, same claims
        conn.execute("reset role")
        v = conn.execute(q).fetchone()[0]
        conn.execute("set local role authenticated")
        return v

    mine = lambda: owner("select app.my_soldier()")
    board = lambda: owner("select app.can_view_board()")
    with conn.transaction():
        conn.execute("update soldiers set release_date = (now() at time zone app.tz())::date where id = %s", (sid,))
        conn.execute("set local role authenticated")
        _claims(conn, uid, aal="aal1")
        # the last day of his service still counts
        assert conn.execute("select public.my_access()").fetchone()[0] is None
        assert mine() == sid
        conn.execute("reset role")
        conn.execute("update soldiers set release_date = (now() at time zone app.tz())::date - 1 where id = %s", (sid,))
        conn.execute("set local role authenticated")
        _claims(conn, uid, aal="aal1")
        assert conn.execute("select public.my_access()").fetchone()[0] == "released"
        assert mine() is None
        assert board() is False
        assert conn.execute("select count(*) from public.my_duties()").fetchone()[0] == 0
        conn.execute("reset role")
        # a staff role on the same account keeps working
        conn.execute("insert into user_roles (user_id, role) values (%s, 'viewer')", (uid,))
        conn.execute("set local role authenticated")
        _claims(conn, uid, aal="aal1")
        assert conn.execute("select public.my_access()").fetchone()[0] is None
        assert board() is True
        assert mine() is None
        conn.execute("reset role")
        raise psycopg.Rollback()
    with conn.transaction():
        conn.execute("update soldiers set is_active = false where id = %s", (sid,))  # taken out of the unit
        conn.execute("set local role authenticated")
        _claims(conn, uid, aal="aal1")
        assert conn.execute("select public.my_access()").fetchone()[0] == "released"
        conn.execute("reset role")
        conn.execute("update app_users set is_locked = true where id = %s", (uid,))
        conn.execute("set local role authenticated")
        _claims(conn, uid, aal="aal1")
        assert conn.execute("select public.my_access()").fetchone()[0] == "locked"
        conn.execute("reset role")


def test_duty_message_for_soldier_without_account(conn):
    cycle = conn.cycle_id
    with conn.transaction():
        conn.execute("update cycles set status = 'published', published_at = now() - interval '1 hour' where id = %s", (cycle,))
        tid = conn.execute("select task_type_id from slots where cycle_id = %s limit 1", (cycle,)).fetchone()[0]
        conn.execute("update task_types set briefing = %s where id = %s",
                     ('{"kind": "report", "rule": "same_day", "time": "07:30", "place": "שער ראשי"}', tid))
        slot = lambda h: conn.execute("insert into slots (cycle_id, task_type_id, starts_at, ends_at) values "
                                      "(%s, %s, now() + make_interval(hours => %s), now() + make_interval(hours => %s + 8)) returning id",
                                      (cycle, tid, h, h)).fetchone()[0]
        s1, s2 = slot(30), slot(100)
        free = conn.execute("select id from soldiers s where is_active and not exists "
                            "(select 1 from app_users u where u.soldier_id = s.id) order by id limit 1").fetchone()[0]
        put = lambda k, role: conn.execute(
            "insert into assignments (slot_id, soldier_id, gaf_id, role, status, source, manual_reason, points, normalized_points) "
            "select %s, id, gaf_id, %s, %s, 'manual', 'בדיקה', 1, 1 from soldiers where id = %s returning id",
            (k, role, 'assigned' if role == 'performer' else 'reserve_idle', free)).fetchone()[0]
        a1, a2 = put(s1, 'performer'), put(s2, 'reserve')
        conn.execute("set local role authenticated")
        _claims(conn, COORD)
        # after publishing: he is on the list, not yet sent
        rows = {r[0]: r for r in conn.execute("select soldier_id, duties, sent from public.no_account_duties(%s)", (cycle,)).fetchall()}
        assert rows[free][1] >= 2 and rows[free][2] is False
        # one message for the cycle: both duties, the briefing line, and a code
        m = conn.execute("select public.duty_message(%s, null, %s)", (free, cycle)).fetchone()[0]
        ids = [d["assignment_id"] for d in m["duties"]]
        assert str(a1) in ids and str(a2) in ids and m["has_account"] is False
        assert len(m["code"]) == 11 and m["code"][5] == "-"
        d1 = next(d for d in m["duties"] if d["assignment_id"] == str(a1))
        assert d1["role"] == "performer" and d1["brief"].startswith("התייצבות") and "שער ראשי" in d1["brief"]
        # the code works (its hash), and the list now says sent
        code = m["code"]
        conn.execute("reset role")
        assert conn.execute("select count(*) from soldier_invites where soldier_id = %s and used_at is null and revoked_at is null "
                            "and code_hash = app.invite_hash(%s)", (free, code)).fetchone()[0] == 1
        conn.execute("set local role authenticated")
        _claims(conn, COORD)
        assert conn.execute("select sent from public.no_account_duties(%s) where soldier_id = %s", (cycle, free)).fetchone()[0] is True
        # one duty: only that one; a second message replaces the code
        m2 = conn.execute("select public.duty_message(null, %s)", (a2,)).fetchone()[0]
        assert [d["assignment_id"] for d in m2["duties"]] == [str(a2)] and m2["duties"][0]["role"] == "reserve"
        assert m2["code"] != code
        conn.execute("reset role")
        assert conn.execute("select count(*) from soldier_invites where soldier_id = %s and used_at is null and revoked_at is null",
                            (free,)).fetchone()[0] == 1
        raise psycopg.Rollback()


def test_new_exemption_request_alerts_staff_grouped(conn):
    from datetime import date, timedelta

    uid, sid = _soldier_account(conn, "req.alert")
    etype = conn.execute("select id from exemption_types where auto_rule is null order by name limit 1").fetchone()[0]
    far = date.today() + timedelta(days=700)
    with conn.transaction():
        gaf = conn.execute("select gaf_id from soldiers where id = %s", (sid,)).fetchone()[0]
        other = conn.execute("select id from org_units where kind = 'gaf' and id <> %s limit 1", (gaf,)).fetchone()[0]
        mk = lambda name, g: conn.execute("select app.create_auth_user(%s, 'x-long-password')", (name + "@users.invalid",)).fetchone()[0]
        cmd, cmd2 = mk("ra.cmd", gaf), mk("ra.cmd2", other)
        for u, n, g in ((cmd, "ra.cmd", gaf), (cmd2, "ra.cmd2", other)):
            conn.execute("insert into app_users (id, username) values (%s, %s)", (u, n))
            conn.execute("insert into user_roles (user_id, role, gaf_id) values (%s, 'gaf_commander', %s)", (u, g))
        conn.execute("delete from notifications")
        # the soldier asks twice within the hour
        conn.execute("set local role authenticated")
        _claims(conn, uid, aal="aal1")
        conn.execute("select public.submit_exemption(%s, %s, %s)", (etype, far, far + timedelta(days=5)))
        conn.execute("select public.submit_exemption(%s, %s, %s)", (etype, far + timedelta(days=30), far + timedelta(days=35)))
        conn.execute("reset role")
        rows = lambda u: conn.execute("select payload from notifications where recipient_user_id = %s and type = 'exemption_request'", (u,)).fetchall()
        (p,), = rows(COORD)
        assert p["count"] == 2 and p["title"] == "2 בקשות פטור חדשות"
        assert len(rows(cmd)) == 1 and rows(cmd2) == []          # his gaf only
        (pc,), = rows(cmd)
        # read notices do not swallow the next one
        conn.execute("update notifications set read_at = now() where recipient_user_id = %s", (COORD,))
        # נע"ת writes one himself: nothing to him; turned off: nothing to the gaf commander
        conn.execute("update app_users set request_alerts = false where id = %s", (cmd,))
        conn.execute("set local role authenticated")
        _claims(conn, COORD)
        conn.execute("insert into exemptions (soldier_id, exemption_type_id, kind, start_date, end_date, status, source) "
                     "values (%s, %s, 'full', %s, %s, 'pending', 'coordinator')", (sid, etype, far + timedelta(days=60), far + timedelta(days=61)))
        conn.execute("reset role")
        assert len(rows(COORD)) == 1 and len(rows(cmd)) == 1
        assert conn.execute("select count(*) from notifications where recipient_user_id = %s and type = 'exemption_request'",
                            (DEPUTY_ACTIVE,)).fetchone()[0] >= 1
        # 48 hours before the deadline: what still waits – once
        cyc = conn.execute("insert into cycles (name, start_date, end_date, exemption_deadline) values ('בדיקה', %s, %s, now() + interval '30 hours') returning id",
                           (far, far + timedelta(days=90))).fetchone()[0]
        assert conn.execute("select app.queue_pending_reminders()").fetchone()[0] == 1
        assert conn.execute("select app.queue_pending_reminders()").fetchone()[0] == 0
        (pp,), = conn.execute("select payload from notifications where recipient_user_id = %s and type = 'exemption_pending'", (COORD,)).fetchall()
        assert pp["title"] == "עוד 3 בקשות פטור ממתינות" and pp["cycle_id"] == str(cyc)
        assert conn.execute("select count(*) from notifications where type = 'exemption_pending' and recipient_user_id in (%s, %s)",
                            (cmd, cmd2)).fetchone()[0] == 0


def test_soldier_contacts_show_only_the_chosen(conn):
    uid, sid = _soldier_account(conn, "contacts.me")
    with conn.transaction():
        gaf = conn.execute("select gaf_id from soldiers where id = %s", (sid,)).fetchone()[0]
        other = conn.execute("select id from org_units where kind = 'gaf' and id <> %s limit 1", (gaf,)).fetchone()[0]
        cmds = []
        for n, g in (("ct.cmd", gaf), ("ct.cmd2", other)):
            u = conn.execute("select app.create_auth_user(%s, 'x-long-password')", (n + "@users.invalid",)).fetchone()[0]
            conn.execute("insert into app_users (id, username) values (%s, %s)", (u, n))
            conn.execute("insert into user_roles (user_id, role, gaf_id) values (%s, 'gaf_commander', %s)", (u, g))
            cmds.append(u)
        conn.execute("set local role authenticated")
        # nothing chosen: nothing shown
        _claims(conn, uid, aal="aal1")
        assert conn.execute("select count(*) from public.my_contacts()").fetchone()[0] == 0
        # a soldier cannot set the list; נע"ת can
        with pytest.raises(psycopg.Error):
            with conn.transaction():
                conn.execute("select public.set_soldier_contacts('[]')")
        _claims(conn, COORD)
        with pytest.raises(psycopg.Error, match="לא תקין"):
            with conn.transaction():
                conn.execute("select public.set_soldier_contacts(%s)", (json.dumps([{"user_id": str(COORD), "display_name": "נעת", "phone": "123"}]),))
        with pytest.raises(psycopg.Error, match="פעיל"):
            with conn.transaction():
                conn.execute("select public.set_soldier_contacts(%s)", (json.dumps([{"user_id": str(uid), "display_name": "חייל"}]),))
        n = conn.execute("select public.set_soldier_contacts(%s)", (json.dumps([
            {"user_id": str(COORD), "display_name": "נע\"ת לדוגמה", "phone": "050-000-0001"},
            {"user_id": str(DEPUTY_ACTIVE), "display_name": "מ\"מ לדוגמה"},
            {"user_id": str(cmds[0]), "display_name": "מפקד גף א", "phone": "0500000003"},
            {"user_id": str(cmds[1]), "display_name": "מפקד גף ב", "phone": "0500000004"},
        ]),)).fetchone()[0]
        assert n == 4
        # the soldier: נע"ת, מ"מ and his own gaf's commander – not the other gaf's
        _claims(conn, uid, aal="aal1")
        rows = conn.execute("select display_name, role_label, phone, kind from public.my_contacts()").fetchall()
        assert rows == [("נע\"ת לדוגמה", "נע\"ת התורנויות", "972500000001", "staff"),
                        ("מ\"מ לדוגמה", "ממלא מקום נע\"ת", None, "staff"),
                        ("מפקד גף א", "מפקד המסגרת", "972500000003", "gaf")]
        # the list itself is staff only
        assert conn.execute("select count(*) from public.soldier_contacts_list()").fetchone()[0] == 0
        raise psycopg.Rollback()


def test_add_soldier_keeps_shachar_second_role_and_tash(conn):
    with conn.transaction():
        gaf, rank = conn.execute("select gaf_id, computed_rank_id from soldiers where is_active and service_type = 'mandatory' limit 1").fetchone()
        base = {"full_name": "חייל ידני", "gaf_id": str(gaf), "rank_id": str(rank), "is_shachar": True, "second_role_signed_at": "2026-10-01", "tash_level": 5}
        conn.execute("set local role authenticated")
        _claims(conn, COORD)
        m = conn.execute("select public.add_soldier(%s)", (json.dumps({**base, "soldier_key": "cd" * 32, "service_type": "mandatory"}),)).fetchone()[0]
        c = conn.execute("select public.add_soldier(%s)", (json.dumps({**base, "soldier_key": "ef" * 32, "service_type": "career"}),)).fetchone()[0]
        conn.execute("reset role")
        got = lambda sid: conn.execute("select is_shachar, second_role_signed_at::text, tash_level from soldiers where id = %s", (sid,)).fetchone()
        assert got(m["id"]) == (True, "2026-10-01", 5)
        assert got(c["id"]) == (False, "2026-10-01", 5)   # שח"ר is for mandatory service only
        raise psycopg.Rollback()


def test_feedback_named_and_anonymous_reach_the_inbox(conn):
    sol, _ = _soldier_account(conn, "fb.sender")
    cmd = _as_coord(conn, "select public.create_user('fb.unitcmd', 'temp-pass-123', 'unit_commander', null)")[0][0]
    with conn.transaction():
        conn.execute("delete from feedback")
        conn.execute("set local role authenticated")
        _claims(conn, sol, aal="aal1")
        named = conn.execute("select public.submit_feedback('idea', '  כפתור לייצוא ליומן  ', false, '/my', '2.35.0', 'phone')").fetchone()[0]
        anon = conn.execute("select public.submit_feedback('bug', 'משהו לא נטען', true, '/requests', '2.35.0', 'desktop')").fetchone()[0]
        # a soldier does not read the inbox
        assert conn.execute("select count(*) from public.feedback_list()").fetchone()[0] == 0
        assert conn.execute("select public.feedback_new_count()").fetchone()[0] == 0
        with pytest.raises(psycopg.Error):
            with conn.transaction():
                conn.execute("select public.update_feedback(%s, 'done')", (named,))
        # five a day
        for _ in range(3):
            conn.execute("select public.submit_feedback('note', 'עוד', false)")
        with pytest.raises(psycopg.Error, match="עד 5"):
            with conn.transaction():
                conn.execute("select public.submit_feedback('note', 'שישית', false)")
        conn.execute("reset role")
        # nothing ties the anonymous one to him
        assert conn.execute("select sender_user_id, sender_name from feedback where id = %s", (anon,)).fetchone() == (None, None)
        assert conn.execute("select body, sender_user_id from feedback where id = %s", (named,)).fetchone() == ("כפתור לייצוא ליומן", sol)
        # the unit commander reads, counts and closes; the named sender hears back
        conn.execute("set local role authenticated")
        _claims(conn, cmd)
        rows = {r[0]: r for r in conn.execute("select id, anonymous, sender_name, screen, device from public.feedback_list()").fetchall()}
        assert rows[anon][1] is True and rows[anon][2] is None and rows[anon][3] == "/requests"
        assert rows[named][1] is False and rows[named][2] and rows[named][4] == "phone"
        assert conn.execute("select public.feedback_new_count()").fetchone()[0] == 5
        conn.execute("select public.update_feedback(%s, 'done', 'פנימי', 'הוספנו!')", (named,))
        conn.execute("select public.update_feedback(%s, 'wont', null, 'לא עכשיו')", (anon,))
        assert conn.execute("select public.feedback_new_count()").fetchone()[0] == 3
        conn.execute("reset role")
        (p,), = conn.execute("select payload from notifications where recipient_user_id = %s and type = 'feedback_reply'", (sol,)).fetchall()
        assert p["title"] == "ההצעה שלך בוצעה – תודה!" and p["body"].startswith("הוספנו!")
        assert conn.execute("select count(*) from notifications where type = 'feedback_reply'").fetchone()[0] == 1
        raise psycopg.Rollback()


def test_spec_document_for_staff_and_commanders_only(conn):
    sol, _ = _soldier_account(conn, "spec.reader")
    (doc,), = _as_coord(conn, "select public.spec_document()")
    assert doc["version"] and doc["body"].startswith("# ") and "/spec/" in doc["body"]
    # the copy in the database is docs/spec.md – a change to the spec needs a migration with it
    spec = (pathlib.Path(__file__).resolve().parents[2] / "docs" / "spec.md").read_text(encoding="utf-8")
    assert doc["body"] == spec, "docs/spec.md changed without a migration that updates app.spec_document"
    gaf_cmd = _as_coord(conn, "select public.create_user('spec.gafcmd', 'temp-pass-123', 'gaf_commander', null)")[0][0]
    with conn.transaction():
        conn.execute("set local role authenticated")
        _claims(conn, gaf_cmd)
        assert conn.execute("select public.spec_document()").fetchone()[0]["body"].startswith("# ")
    with conn.transaction():
        conn.execute("set local role authenticated")
        _claims(conn, sol, aal="aal1")
        with pytest.raises(psycopg.Error, match="אין הרשאה"):
            with conn.transaction():
                conn.execute("select public.spec_document()")
        # the table itself is closed
        with pytest.raises(psycopg.Error):
            with conn.transaction():
                conn.execute("select body from app.spec_document")


def test_frameworks_stored_without_the_gaf_prefix(conn):
    # the 2.43 migration: "גף X" → "X"; one that exists under both names is merged into "X"
    mig = (pathlib.Path(__file__).resolve().parents[2] / "supabase" / "migrations"
           / "20261121000130_terms_framework_employee.sql").read_text(encoding="utf-8")
    rename = mig[mig.index("do $$"):mig.index("end $$;") + len("end $$;")]
    with conn.transaction():
        unit = conn.execute("select id from org_units where kind = 'unit' limit 1").fetchone()[0]
        a = conn.execute("insert into org_units (kind, name, parent_id) values ('gaf', 'גף שמות1', %s) returning id", (unit,)).fetchone()[0]
        b_old = conn.execute("insert into org_units (kind, name, parent_id) values ('gaf', 'גף שמות2', %s) returning id", (unit,)).fetchone()[0]
        b_new = conn.execute("insert into org_units (kind, name, parent_id) values ('gaf', 'שמות2', %s) returning id", (unit,)).fetchone()[0]
        sid = conn.execute("select id from soldiers limit 1").fetchone()[0]
        conn.execute("update soldiers set gaf_id = %s where id = %s", (b_old, sid))
        conn.execute(rename)
        assert conn.execute("select name from org_units where id = %s", (a,)).fetchone()[0] == "שמות1"
        assert conn.execute("select gaf_id from soldiers where id = %s", (sid,)).fetchone()[0] == b_new
        merged = conn.execute("select merged_into_id, active_to is not null from org_units where id = %s", (b_old,)).fetchone()
        assert merged == (b_new, True)
        assert conn.execute("select count(*) from org_units where kind = 'gaf' and name ~ '^גף\\s' and merged_into_id is null").fetchone()[0] == 0
        raise psycopg.Rollback()
