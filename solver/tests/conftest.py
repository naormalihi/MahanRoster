"""If OR-Tools is missing, install the HiGHS-backed shim so the model is still exercised."""

import importlib.util
import sys
import types

if importlib.util.find_spec("ortools") is None:
    from . import cpsat_shim

    pkg = types.ModuleType("ortools")
    sat = types.ModuleType("ortools.sat")
    python = types.ModuleType("ortools.sat.python")
    python.cp_model = cpsat_shim
    sat.python = python
    pkg.sat = sat
    sys.modules.update(
        {"ortools": pkg, "ortools.sat": sat, "ortools.sat.python": python, "ortools.sat.python.cp_model": cpsat_shim}
    )
    USING_SHIM = True
else:
    USING_SHIM = False
