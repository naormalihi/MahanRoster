"""Job worker: takes queued scheduling runs from the database, solves, writes back.

Runs as a Cloud Run Job (or a GitHub Actions job) with DATABASE_URL pointing at
the Supabase Postgres connection string. It processes every queued job and
exits, so it costs nothing while idle.

    DATABASE_URL=postgresql://... python -m mahanroster_solver.worker
"""

from __future__ import annotations

import json
import time
import logging
import os
import sys
import traceback

from . import models
from .rolling import solve_rolling
from .verify import violations

log = logging.getLogger("mahanroster.worker")


def claim(conn):
    """Take one queued job, skipping jobs another worker is holding."""
    with conn.transaction():
        row = conn.execute(
            """select id, input from schedule_jobs
               where status = 'queued' order by created_at limit 1 for update skip locked"""
        ).fetchone()
        if row is None:
            return None
        run = os.environ.get("GITHUB_RUN_ID")
        run_url = f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/{os.environ.get('GITHUB_REPOSITORY')}/actions/runs/{run}" if run else None
        conn.execute(
            """update schedule_jobs set status = 'running', started_at = now(), progress = 1,
                 params = params || jsonb_build_object('run_url', %s::text) where id = %s""",
            (run_url, row[0]),
        )
        return row


def run_one(conn, job_id, payload) -> str:
    problem = models.load_problem(json.dumps(payload))

    last = [0.0]

    def progress(done: int, total: int, staffed: int = 0, slots: int = 0, phase: str = "searching") -> None:
        # 5–95 % while solving month by month, how many duties are staffed so far ("108/180"), and
        # whether the current month is still searching or already balancing; at most every 3 s
        # inside a month, so better solutions do not flood the database
        now = time.monotonic()
        if phase == "improving" and now - last[0] < 3:
            return
        last[0] = now
        conn.execute(
            """update schedule_jobs set progress = %s,
                 params = params || jsonb_build_object('staffed', %s::int, 'slots', %s::int, 'month', %s::int,
                                                       'months', %s::int, 'phase', %s::text)
               where id = %s""",
            (5 + int(90 * done / max(total, 1)), staffed, slots, done, total, phase, job_id),
        )

    progress(0, 1, 0, len(problem.slots))
    solution = solve_rolling(problem, on_progress=progress)
    bad = violations(problem, solution)
    if bad:
        # Never store a schedule that breaks a hard rule.
        solution.status = "MODEL_INVALID"
        solution.warnings = ["verifier: " + v for v in bad[:50]] + solution.warnings
    from psycopg.types.json import Jsonb

    with conn.transaction():
        conn.execute("select public.apply_solver_result(%s, %s)", (job_id, Jsonb(models._to_jsonable(solution))))
    return solution.status


def main() -> int:
    import psycopg

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    url = os.environ["DATABASE_URL"]
    done = 0
    with psycopg.connect(url, autocommit=True) as conn:
        while (job := claim(conn)) is not None:
            job_id, payload = job
            log.info("job %s: solving", job_id)
            try:
                status = run_one(conn, job_id, payload)
                log.info("job %s: %s", job_id, status)
            except Exception as exc:  # report the failure on the job row, keep going
                log.error("job %s failed: %s", job_id, exc)
                conn.execute(
                    "update schedule_jobs set status = 'failed', error = %s, finished_at = now() where id = %s",
                    (traceback.format_exc()[-4000:], job_id),
                )
            done += 1
    log.info("processed %d job(s)", done)
    return 0


if __name__ == "__main__":
    sys.exit(main())
