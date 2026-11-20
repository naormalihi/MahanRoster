"""Through the API Supabase refuses a DELETE or UPDATE without a WHERE (pg_safeupdate), even
inside a function the API calls. The local test database does not load it, so check the code:
no migration may have a delete/update statement without a where."""
import re
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"


def _statements(sql: str):
    for m in re.finditer(r"^\s*(delete\s+from|update)\s+[a-z_.]+\b[^;]*;", sql, re.I | re.M):
        yield m.start(), m.group(0)


def test_no_delete_or_update_without_where():
    bad = []
    fixed_later = {("20261119000099_soldier_contacts.sql", "delete from soldier_contacts;")}
    for f in sorted(MIGRATIONS.glob("*.sql")):
        sql = f.read_text(encoding="utf-8")
        for pos, st in _statements(sql):
            flat = " ".join(st.split())
            if re.search(r"\bwhere\b", flat, re.I) or "on conflict" in flat.lower():
                continue
            if (f.name, flat) in fixed_later:
                continue
            # one-time data changes at the top level of a migration run as the owner, not through the API
            in_function = sql[:pos].count("$$") % 2 == 1
            if in_function:
                bad.append(f"{f.name}:{sql[:pos].count(chr(10)) + 1}: {flat[:90]}")
    assert not bad, "delete/update without where inside a function (the API refuses it):\n" + "\n".join(bad)
