"""Human-readable fairness report (Markdown, Hebrew)."""

from __future__ import annotations

from collections import Counter

from .eligibility import label
from .models import Problem, Solution
from .verify import violations

POOL_NAMES = {"mandatory": "חובה", "career": "קבע"}


def render(problem: Problem, solution: Solution) -> str:
    lines = [f"# דוח שיבוץ – {solution.cycle_id}", ""]
    perf = sum(1 for a in solution.assignments if a.role == "performer")
    res = sum(1 for a in solution.assignments if a.role == "reserve")
    lines += [
        f"- סטטוס הפותר: **{solution.status}**, זמן ריצה {solution.wall_time_seconds} שניות",
        f"- משבצות: {len(problem.slots)}, שיבוצי מבצע: {perf}, שיבוצי עתודה: {res}",
        f"- חיילים: {len(problem.soldiers)}",
        "",
        "## הוגנות לפי אוכלוסייה (ניקוד מנורמל צפוי)",
        "",
        "| אוכלוסייה | חיילים | ממוצע לפני | ממוצע אחרי | מינימום | מקסימום | סטיית תקן | מקס' סופ\"שים | מקס' עתודות |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for p in solution.pools:
        lines.append(
            f"| {POOL_NAMES.get(p.population, p.population)} | {p.soldiers} | {p.mean_before} | {p.mean_after} | "
            f"{p.min_after} | {p.max_after} | {p.stdev_after} | {p.max_weekends} | {p.max_reserves} |"
        )
    lines.append("")

    if solution.unfilled:
        lines += ["## משבצות שלא אוישו", "", "| משבצת | תפקיד | חסרים | זכאים | סיבות עיקריות |", "| --- | --- | --- | --- | --- |"]
        for u in solution.unfilled:
            top = ", ".join(f"{label(r)} ({n})" for r, n in Counter(u.reasons).most_common(3))
            lines.append(f"| {u.slot_id} | {u.role} | {u.missing} | {u.eligible_count} | {top} |")
        lines.append("")
    else:
        lines += ["כל המשבצות אוישו.", ""]

    bad = violations(problem, solution)
    lines += ["## בדיקת כללים קשיחים", ""]
    lines += [f"- {v}" for v in bad[:50]] if bad else ["לא נמצאו הפרות."]
    if solution.warnings:
        lines += ["", "## אזהרות", ""] + [f"- {w}" for w in solution.warnings]
    return "\n".join(lines) + "\n"
