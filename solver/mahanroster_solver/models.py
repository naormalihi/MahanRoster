"""Data contract for the scheduling engine.

The engine receives one JSON document per run (a `Problem`) and returns one
JSON document (a `Solution`). Everything the engine needs is resolved before
the run by the database layer: computed rank (snapshot taken when the
potential was calculated), populations, baseline score in the rolling window,
approved exemptions, absences and date blocks. The engine holds no personal
numbers and no medical details – soldiers are identified by opaque ids only.

Times are local (Asia/Jerusalem) naive ISO strings, e.g. "2027-01-07T08:00".
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field, fields, is_dataclass
from datetime import date, datetime, time
from typing import Any, Optional, get_args, get_origin, get_type_hints

SERVICE_MANDATORY = "mandatory"
SERVICE_CAREER = "career"
ROLE_PERFORMER = "performer"
ROLE_RESERVE = "reserve"


@dataclass
class TaskType:
    id: str
    name: str
    weight: float
    min_rest_hours: int = 0
    # "any" | "mandatory" | "career"
    service_restriction: str = "any"
    requires_weapon: bool = False
    # A Shabbat variant has its own weight, so the weekend multiplier is not applied.
    is_weekend_type: bool = False
    shachar_compatible: bool = False
    # ממלכ"ת יום – the only duty open to parents and to holders of a qualifying exemption.
    qualifying_duty: bool = False
    # Empty list = open to every population.
    eligible_populations: list[str] = field(default_factory=list)
    rank_min: Optional[int] = None  # rank sort_order, inclusive
    rank_max: Optional[int] = None
    gender: Optional[str] = None  # "male" | "female" | None
    category_id: Optional[str] = None


@dataclass
class LoadRolePeriod:
    """A load-relief role (e.g. team leader 0.5) valid for a date range."""

    factor: float
    valid_from: date
    valid_to: Optional[date] = None


@dataclass
class Soldier:
    id: str
    gaf_id: str
    service_type: str  # "mandatory" | "career"
    rank_order: int  # computed rank (or appointment rank) frozen for the cycle
    populations: list[str] = field(default_factory=list)
    gender: Optional[str] = None
    enlistment_date: Optional[date] = None
    release_date: Optional[date] = None
    unit_join_date: Optional[date] = None
    range_valid_until: Optional[date] = None
    is_shachar: bool = False
    # Parent, or holder of an exemption marked "qualifies for day duty only".
    qualifies_day_only: bool = False
    # Fairness pool: soldiers are compared only inside their pool.
    balance_population: str = SERVICE_MANDATORY
    # Normalized score in the rolling window before the cycle, opening points included.
    baseline_score: float = 0.0
    baseline_weekends: int = 0
    baseline_reserves: int = 0
    load_roles: list[LoadRolePeriod] = field(default_factory=list)

    def factor_on(self, day: date) -> float:
        active = [
            r.factor
            for r in self.load_roles
            if r.valid_from <= day and (r.valid_to is None or day <= r.valid_to)
        ]
        return min(active) if active else 1.0


@dataclass
class Exemption:
    soldier_id: str
    start_date: date
    end_date: date
    # None = full exemption from every duty.
    excluded_task_type_ids: Optional[list[str]] = None
    # Partial exemption by hours, e.g. "18:00-06:00".
    restricted_hours: Optional[str] = None


@dataclass
class Absence:
    soldier_id: str
    starts_at: datetime
    ends_at: datetime


@dataclass
class DateBlock:
    soldier_id: str
    date: date


@dataclass
class PersonalConstraint:
    soldier_id: str
    task_type_id: Optional[str] = None  # None = every duty
    time_window: Optional[str] = None  # "HH:MM-HH:MM", None = all day
    valid_until: Optional[date] = None


@dataclass
class Slot:
    id: str
    task_type_id: str
    starts_at: datetime
    ends_at: datetime
    performers_needed: int = 1
    reserves_needed: int = 1
    # Per-slot overrides of the task type.
    rank_min: Optional[int] = None
    rank_max: Optional[int] = None
    gender: Optional[str] = None
    is_penalty: bool = False
    penalty_soldier_id: Optional[str] = None


@dataclass
class FixedAssignment:
    """An assignment the engine must keep (manual lock, published slot in stability mode)."""

    slot_id: str
    soldier_id: str
    role: str = ROLE_PERFORMER


@dataclass
class Weights:
    """Soft-objective weights. All terms are measured in normalized points."""

    max_score: float = 10.0  # minimize the highest expected score in each pool
    deviation: float = 1.0  # minimize the spread around the pool mean
    weekend: float = 3.0  # balance weekend/holiday units per soldier
    reserve: float = 1.0  # balance how often each soldier is a reserve
    consecutive_weekends: float = 2.0
    same_week: float = 1.0  # more than one duty in the same week
    cross_gaf_reserve: float = 5.0  # career reserve from another gaf


@dataclass
class Settings:
    weekend_multiplier: float = 1.5
    holiday_multiplier: float = 2.0
    night_multiplier: float = 1.25
    night_window: str = "22:00-06:00"
    weekend_weekdays: list[int] = field(default_factory=lambda: [4, 5])  # Fri, Sat
    grace_days: int = 30
    duty_cap_per_month: Optional[int] = None
    weights: Weights = field(default_factory=Weights)
    time_limit_seconds: float = 60.0
    workers: int = 8
    random_seed: int = 0


@dataclass
class Problem:
    cycle_id: str
    cycle_start: date
    cycle_end: date
    task_types: list[TaskType]
    soldiers: list[Soldier]
    slots: list[Slot]
    settings: Settings = field(default_factory=Settings)
    holidays: list[date] = field(default_factory=list)  # holidays and holiday eves
    exemptions: list[Exemption] = field(default_factory=list)
    absences: list[Absence] = field(default_factory=list)
    date_blocks: list[DateBlock] = field(default_factory=list)
    personal_constraints: list[PersonalConstraint] = field(default_factory=list)
    fixed: list[FixedAssignment] = field(default_factory=list)
    # Periods a soldier is already committed outside this run (a duty from an earlier
    # window or an already-published duty), rest included. Treated like an absence.
    busy: list[Absence] = field(default_factory=list)


@dataclass
class AssignmentOut:
    slot_id: str
    soldier_id: str
    role: str
    points: float  # raw points (0 for a reserve and for a penalty slot)
    normalized_points: float
    explanation: str


@dataclass
class UnfilledOut:
    slot_id: str
    role: str
    missing: int
    eligible_count: int
    reasons: dict[str, int]  # ineligibility reason -> number of soldiers


@dataclass
class PoolStats:
    population: str
    soldiers: int
    mean_before: float
    mean_after: float
    min_after: float
    max_after: float
    stdev_after: float
    max_weekends: int
    max_reserves: int


@dataclass
class Solution:
    cycle_id: str
    status: str  # OPTIMAL | FEASIBLE | INFEASIBLE | MODEL_INVALID | UNKNOWN
    objective: Optional[float]
    wall_time_seconds: float
    assignments: list[AssignmentOut] = field(default_factory=list)
    unfilled: list[UnfilledOut] = field(default_factory=list)
    pools: list[PoolStats] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# JSON (de)serialization
# ---------------------------------------------------------------------------


def _to_jsonable(value: Any) -> Any:
    if is_dataclass(value):
        return {k: _to_jsonable(v) for k, v in asdict(value).items()}
    if isinstance(value, dict):
        return {k: _to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_jsonable(v) for v in value]
    if isinstance(value, datetime):
        return value.isoformat(timespec="minutes")
    if isinstance(value, (date, time)):
        return value.isoformat()
    return value


def _from_jsonable(tp: Any, value: Any) -> Any:
    if value is None:
        return None
    origin = get_origin(tp)
    if origin is not None and type(None) in get_args(tp):  # Optional[X]
        inner = [a for a in get_args(tp) if a is not type(None)][0]
        return _from_jsonable(inner, value)
    if origin is list:
        (inner,) = get_args(tp)
        return [_from_jsonable(inner, v) for v in value]
    if origin is dict:
        _, vt = get_args(tp)
        return {k: _from_jsonable(vt, v) for k, v in value.items()}
    if is_dataclass(tp):
        hints = get_type_hints(tp)
        known = {f.name for f in fields(tp)}
        unknown = set(value) - known
        if unknown:
            raise ValueError(f"{tp.__name__}: unknown fields {sorted(unknown)}")
        return tp(**{k: _from_jsonable(hints[k], v) for k, v in value.items()})
    if tp is datetime:
        return datetime.fromisoformat(value)
    if tp is date:
        return date.fromisoformat(value)
    if tp is float:
        return float(value)
    return value


def dumps(obj: Any) -> str:
    return json.dumps(_to_jsonable(obj), ensure_ascii=False, indent=2)


def load_problem(text: str) -> Problem:
    return _from_jsonable(Problem, json.loads(text))


def load_solution(text: str) -> Solution:
    return _from_jsonable(Solution, json.loads(text))
