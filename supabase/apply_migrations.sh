#!/usr/bin/env bash
# Apply supabase/migrations/*.sql that have not been applied yet, in order, each in
# one transaction, and record them in public.schema_migrations.
#   DATABASE_URL=postgresql://... supabase/apply_migrations.sh
set -euo pipefail
cd "$(dirname "$0")"
: "${DATABASE_URL:?DATABASE_URL is required}"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q)

"${PSQL[@]}" -c "create table if not exists public.schema_migrations (
  version text primary key, applied_at timestamptz not null default now())"
"${PSQL[@]}" -c "alter table public.schema_migrations enable row level security"

applied=$("${PSQL[@]}" -At -c "select version from public.schema_migrations")
for f in migrations/*.sql; do
  v=$(basename "$f" .sql)
  if grep -qx "$v" <<<"$applied"; then echo "skip  $v"; continue; fi
  echo "apply $v"
  "${PSQL[@]}" -1 -f "$f" -c "insert into public.schema_migrations (version) values ('$v')"
done
echo "done"
