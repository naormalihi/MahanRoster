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
    q("insert into populations (code, name) values ('mandatory','חובה'),('career','קבע'),('officer','קצינים'),('major','רס\"ן ומעלה')")
    q("insert into day_types (code, name) values ('weekday','חול'),('weekend','סופ\"ש'),('holiday','חג'),('holiday_eve','ערב חג')")
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
