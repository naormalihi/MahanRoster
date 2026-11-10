"""Independent checker of the hard rules for a finished schedule.

Runs after every solve (and on any manual edit) so that a bug in the model,
or a manual change, cannot publish a schedule that breaks a hard rule. It
shares no code with the CP-SAT model except the eligibility rules.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import timedelta

from .eligibility import EligibilityIndex
from .models import ROLE_PERFORMER, ROLE_RESERVE, SERVICE_MANDATORY, Problem, Solution


def violations(problem: Problem, solution: Solution) -> list[str]:
    idx = EligibilityIndex(problem)
    soldiers = {s.id: s for s in problem.soldiers}
    slots = {k.id: k for k in problem.slots}
    tasks = idx.tasks
    fixed = {(f.soldier_id, f.slot_id, f.role) for f in problem.fixed}
    out: list[str] = []

    per_slot = defaultdict(lambda: defaultdict(list))
    per_soldier = defaultdict(list)
    for a in solution.assignments:
        if a.slot_id not in slots or a.soldier_id not in soldiers:
            out.append(f"שיבוץ למשבצת או לחייל לא מוכרים: {a.slot_id}/{a.soldier_id}")
            continue
        k, s = slots[a.slot_id], soldiers[a.soldier_id]
        per_slot[k.id][a.role].append(s.id)
        per_soldier[s.id].append((k, a.role))
        if (s.id, k.id, a.role) not in fixed:
            reasons = idx.check(s, k)
            if reasons:
                out.append(f"{s.id} ב-{k.id} ({a.role}) לא זכאי: {', '.join(reasons)}")

    for kid, roles in per_slot.items():
        k = slots[kid]
        if len(roles[ROLE_PERFORMER]) > k.performers_needed:
            out.append(f"{kid}: יותר מבצעים מהנדרש")
        if len(roles[ROLE_RESERVE]) > k.reserves_needed:
            out.append(f"{kid}: יותר עתודות מהנדרש")
        both = set(roles[ROLE_PERFORMER]) & set(roles[ROLE_RESERVE])
        if both:
            out.append(f"{kid}: אותו חייל גם מבצע וגם עתודה: {sorted(both)}")
        perf_gafs = {soldiers[p].gaf_id for p in roles[ROLE_PERFORMER]}
        for res in roles[ROLE_RESERVE]:
            if (res, kid, ROLE_RESERVE) in fixed:
                continue  # published facts are kept as they are
            if soldiers[res].service_type == SERVICE_MANDATORY and soldiers[res].gaf_id not in perf_gafs:
                out.append(f"{kid}: עתודת חובה {res} לא מגף המבצע")

    for sid, items in per_soldier.items():
        items.sort(key=lambda it: it[0].starts_at)
        for (a, ra), (b, rb) in zip(items, items[1:]):
            if (sid, a.id, ra) in fixed and (sid, b.id, rb) in fixed:
                continue  # two published facts: kept as they are
            rest = timedelta(hours=tasks[a.task_type_id].min_rest_hours)
            if b.starts_at < a.ends_at + rest:
                out.append(f"{sid}: אין מנוחה מספקת בין {a.id} ל-{b.id}")
        cap = problem.settings.duty_cap_per_month
        if cap:
            months = defaultdict(int)
            new_in = defaultdict(int)
            for k, role in items:
                if role == ROLE_PERFORMER and not k.is_penalty:
                    months[k.starts_at.year, k.starts_at.month] += 1
                    if (sid, k.id, role) not in fixed:
                        new_in[k.starts_at.year, k.starts_at.month] += 1
            for (y, mth), n in months.items():
                if n > cap and new_in[y, mth]:  # published duties alone over the cap are facts
                    out.append(f"{sid}: {n} תורנויות בחודש {mth}/{y}, מעל התקרה {cap}")
    return out
