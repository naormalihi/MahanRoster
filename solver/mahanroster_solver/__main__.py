"""Command line.

    python -m mahanroster_solver generate --months 1 -o problem.json
    python -m mahanroster_solver solve problem.json -o solution.json [--time-limit 60]
    python -m mahanroster_solver report problem.json solution.json -o report.md
    python -m mahanroster_solver verify problem.json solution.json
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import models, report, synthetic, verify


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="mahanroster_solver")
    sub = ap.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("generate", help="create a fictitious unit")
    g.add_argument("--months", type=int, default=1)
    g.add_argument("--soldiers", type=int, default=240)
    g.add_argument("--gafim", type=int, default=6)
    g.add_argument("--seed", type=int, default=1)
    g.add_argument("-o", "--out", required=True)

    s = sub.add_parser("solve", help="solve a problem file")
    s.add_argument("problem")
    s.add_argument("-o", "--out", required=True)
    s.add_argument("--time-limit", type=float, help="total seconds, split across the months")
    s.add_argument("--workers", type=int)
    s.add_argument("--log", action="store_true")

    r = sub.add_parser("report", help="fairness report")
    r.add_argument("problem")
    r.add_argument("solution")
    r.add_argument("-o", "--out")

    v = sub.add_parser("verify", help="check hard rules; exit 1 on violation")
    v.add_argument("problem")
    v.add_argument("solution")

    a = ap.parse_args(argv)
    if a.cmd == "generate":
        p = synthetic.generate(a.months, a.soldiers, a.gafim, seed=a.seed)
        Path(a.out).write_text(models.dumps(p), encoding="utf-8")
        print(f"{len(p.soldiers)} soldiers, {len(p.slots)} slots -> {a.out}")
        return 0

    problem = models.load_problem(Path(a.problem).read_text(encoding="utf-8"))
    if a.cmd == "solve":
        from .rolling import solve_rolling

        if a.time_limit:
            problem.settings.time_limit_seconds = a.time_limit
        if a.workers:
            problem.settings.workers = a.workers
        sol = solve_rolling(problem, log=a.log)  # month by month; a single month is one model
        Path(a.out).write_text(models.dumps(sol), encoding="utf-8")
        print(f"{sol.status} in {sol.wall_time_seconds}s, {len(sol.assignments)} assignments, {len(sol.unfilled)} unfilled")
        return 0 if sol.status in ("OPTIMAL", "FEASIBLE") else 2

    solution = models.load_solution(Path(a.solution).read_text(encoding="utf-8"))
    if a.cmd == "report":
        text = report.render(problem, solution)
        if a.out:
            Path(a.out).write_text(text, encoding="utf-8")
        else:
            sys.stdout.write(text)
        return 0
    bad = verify.violations(problem, solution)
    for line in bad:
        print(line)
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
