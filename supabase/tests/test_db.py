"""Database tests: migrations, RLS per role, audit log, and a full round trip
through the scheduling engine (snapshot → input → solve → apply → publish → board).

Needs a PostgreSQL server (16+) reachable through DATABASE_URL, default
postgresql://postgres:postgres@localhost:5432/postgres. A throwaway database
`mahanroster_test` is created from scratch for the session.
"""

from __future__ import annotations

import hashlib
import json
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
        conn.execute("update settings set value = '2.5' where key = 'holiday_multiplier'")
        v = conn.execute(
            "select value from weight_history where multiplier_key = 'holiday_multiplier' order by id desc limit 1"
        ).fetchone()[0]
        assert float(v) == 2.5


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


STATIC_REASONS = {"service", "population", "rank", "gender", "qualifying_only", "not_qualifying", "shachar", "home_nightly"}


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
    ignore = {"busy", "penalty_other"}  # other-cycle duties: SQL reports them as conflicts instead
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
