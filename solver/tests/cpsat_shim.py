"""A tiny stand-in for `ortools.sat.python.cp_model`, backed by SciPy's HiGHS MILP.

Test-only. It implements just the subset of the CP-SAT API the model uses, so
the model logic can be exercised where OR-Tools cannot be installed. All
intervals in the model have fixed start and end, so NoOverlap becomes
pairwise "at most one" constraints. Production always runs real CP-SAT.
"""

from __future__ import annotations

import itertools

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import csr_matrix

OPTIMAL, FEASIBLE, INFEASIBLE, MODEL_INVALID, UNKNOWN = 4, 2, 3, 1, 0
_NAMES = {4: "OPTIMAL", 2: "FEASIBLE", 3: "INFEASIBLE", 1: "MODEL_INVALID", 0: "UNKNOWN"}


class LinExpr:
    __slots__ = ("terms", "const")

    def __init__(self, terms=None, const=0.0):
        self.terms = terms or {}
        self.const = const

    @staticmethod
    def of(v):
        if isinstance(v, LinExpr):
            return v
        if isinstance(v, (int, float, np.integer, np.floating)):
            return LinExpr({}, float(v))
        raise TypeError(type(v))

    def __add__(self, other):
        o = LinExpr.of(other)
        t = dict(self.terms)
        for k, c in o.terms.items():
            t[k] = t.get(k, 0.0) + c
        return LinExpr(t, self.const + o.const)

    __radd__ = __add__

    def __neg__(self):
        return LinExpr({k: -c for k, c in self.terms.items()}, -self.const)

    def __sub__(self, other):
        return self + (-LinExpr.of(other))

    def __rsub__(self, other):
        return LinExpr.of(other) - self

    def __mul__(self, k):
        if isinstance(k, LinExpr):
            raise TypeError("non-linear")
        return LinExpr({i: c * k for i, c in self.terms.items()}, self.const * k)

    __rmul__ = __mul__

    def __floordiv__(self, k):
        return self * (1.0 / k)

    def __le__(self, other):
        return ("le", self - other)

    def __ge__(self, other):
        return ("ge", self - other)

    def __eq__(self, other):  # noqa: D105 – constraint builder, not equality
        return ("eq", self - other)

    __hash__ = object.__hash__


class Var(LinExpr):
    __slots__ = ("index", "lb", "ub", "name")

    def __init__(self, index, lb, ub, name):
        super().__init__({index: 1.0}, 0.0)
        self.index, self.lb, self.ub, self.name = index, lb, ub, name


class Interval:
    def __init__(self, start, end, presence):
        self.start, self.end, self.presence = start, end, presence


class CpModel:
    def __init__(self):
        self.vars: list[Var] = []
        self.cons: list[tuple[str, LinExpr]] = []
        self.obj = LinExpr()

    def NewBoolVar(self, name):
        return self.NewIntVar(0, 1, name)

    def NewIntVar(self, lb, ub, name):
        v = Var(len(self.vars), lb, ub, name)
        self.vars.append(v)
        return v

    def Add(self, con):
        if isinstance(con, bool):
            if not con:
                raise ValueError("trivially false constraint")
            return
        self.cons.append(con)

    def NewOptionalIntervalVar(self, start, size, end, presence, name):
        return Interval(start, end, presence)

    def AddNoOverlap(self, intervals):
        ivs = sorted(intervals, key=lambda i: i.start)
        for a, b in itertools.combinations(ivs, 2):
            if a.start < b.end and b.start < a.end:
                self.cons.append(("le", a.presence + b.presence - 1))

    def AddMaxEquality(self, target, vars_):
        for v in vars_:
            self.cons.append(("ge", target - v))
        self.cons.append(("le", target - sum(vars_, LinExpr())))

    def Minimize(self, expr):
        self.obj = LinExpr.of(expr)


class _Params:
    max_time_in_seconds = 60.0
    num_search_workers = 1
    random_seed = 0
    log_search_progress = False


class CpSolver:
    def __init__(self):
        self.parameters = _Params()
        self._x = None
        self._obj = None

    def Solve(self, model: CpModel):
        n = len(model.vars)
        c = np.zeros(n)
        for i, k in model.obj.terms.items():
            c[i] += k
        rows, cols, vals, lo, hi = [], [], [], [], []
        for r, (kind, e) in enumerate(model.cons):
            for i, k in e.terms.items():
                rows.append(r)
                cols.append(i)
                vals.append(k)
            b = -e.const
            lo.append(b if kind in ("ge", "eq") else -np.inf)
            hi.append(b if kind in ("le", "eq") else np.inf)
        constraints = []
        if model.cons:
            a = csr_matrix((vals, (rows, cols)), shape=(len(model.cons), n))
            constraints = [LinearConstraint(a, lo, hi)]
        bounds = Bounds([v.lb for v in model.vars], [v.ub for v in model.vars])
        res = milp(
            c,
            constraints=constraints,
            integrality=np.ones(n),
            bounds=bounds,
            options={"time_limit": self.parameters.max_time_in_seconds, "disp": False, "mip_rel_gap": 1e-4},
        )
        if res.x is None:
            return INFEASIBLE if res.status == 2 else UNKNOWN
        self._x = np.round(res.x).astype(int)
        self._obj = float(c @ self._x) + model.obj.const
        return OPTIMAL if res.status == 0 else FEASIBLE

    def Value(self, v):
        return int(self._x[v.index])

    def ObjectiveValue(self):
        return self._obj

    def StatusName(self, status):
        return _NAMES[status]
