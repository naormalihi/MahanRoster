-- =============================================================================
-- מערכת תורנויות – core schema (version 1.0, built to carry 2.0 without migration)
--
-- Rules that shape this schema:
--   * No personal numbers: a soldier is identified by soldier_key = HMAC-SHA256 of
--     the personal number, computed in the browser with a key held by נע"ת.
--   * No medical data: an exemption holds its type, dates and "proof checked" only.
--   * Every record that 2.0 lets soldiers enter themselves carries on_behalf_of,
--     received_via and received_at, so 1.0 data entered by נע"ת looks the same.
--   * All times are timestamptz; the unit's time zone is Asia/Jerusalem.
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create schema if not exists app;  -- private helpers, not exposed through the API

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type service_type      as enum ('mandatory', 'career');
create type gender_type       as enum ('male', 'female');
create type app_role          as enum ('coordinator', 'deputy', 'viewer',
                                       'gaf_commander', 'gaf_rep', 'unit_commander', 'soldier');
create type org_unit_kind     as enum ('unit', 'gaf', 'team');
create type cycle_status      as enum ('draft', 'loading', 'collecting', 'approving', 'potential',
                                       'slots', 'scheduling', 'review', 'published', 'closed');
create type assignment_role   as enum ('performer', 'reserve');
create type assignment_status as enum ('draft', 'assigned', 'done', 'dropped', 'cancelled_approved',
                                       'swapped_out', 'reserve_idle', 'reserve_activated');
create type assignment_source as enum ('solver', 'manual', 'swap', 'escalation');
create type received_via      as enum ('in_person', 'phone', 'message', 'excel', 'system');
create type request_status    as enum ('pending', 'approved', 'rejected', 'expired', 'cancelled');
create type job_status        as enum ('queued', 'running', 'done', 'failed');
create type job_kind          as enum ('full', 'stability', 'simulation');

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Settings (key/value with defaults)
-- ---------------------------------------------------------------------------
create table settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

insert into settings (key, value) values
  ('time_zone',                 '"Asia/Jerusalem"'),
  ('score_window_months',       '6'),
  ('long_absence_months',       '3'),
  ('grace_days',                '30'),
  ('range_warning_days',        '14'),
  ('draft_review_days',         '7'),
  ('block_quota_per_month',     '1'),
  ('duty_cap_per_month',        'null'),
  ('cycle_length_months',       '6'),
  ('weekend_multiplier',        '1.5'),
  ('holiday_multiplier',        '2.0'),
  ('night_multiplier',          '1.25'),
  ('night_window',              '"22:00-06:00"'),
  ('weekend_weekdays',          '[5, 6]'),          -- ISO: Friday=5, Saturday=6
  ('appeal_hours',              '72'),
  ('auto_done_hours',           '48'),
  ('reserve_escalation_hours',  '4'),
  ('phone_confirmation_hours',  '48'),
  ('viewer_password_rotated_at','null'),
  ('solver_time_limit_seconds', '360'),
  ('solver_weights',            '{"max_score":10,"deviation":1,"weekend":3,"reserve":1,"consecutive_weekends":2,"same_week":1,"cross_gaf_reserve":5}');

create or replace function app.setting(k text) returns jsonb
language sql stable as $$ select value from public.settings where key = k $$;

-- ---------------------------------------------------------------------------
-- Organization and reference lists
-- ---------------------------------------------------------------------------
create table org_units (
  id                uuid primary key default gen_random_uuid(),
  parent_id         uuid references org_units(id),
  kind              org_unit_kind not null,
  name              text not null,
  commander_user_id uuid,                       -- FK added after app_users exists
  active_from       date not null default current_date,
  active_to         date,
  merged_into_id    uuid references org_units(id),
  unique (kind, name)
);
comment on table org_units is 'Unit → gaf → team tree. "gaf" rows are what the rest of the schema calls gafim.';

create table gaf_aliases (
  gaf_id uuid not null references org_units(id) on delete cascade,
  alias  text not null,
  source text not null check (source in ('hr_export', 'base_roster', 'manual')),
  primary key (alias, source)
);

create table ranks (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  short_name      text,
  sort_order      int  not null unique,
  population_tags text[] not null default '{}'   -- e.g. {officer} for סגן, {officer,major} for רס"ן
);

create table populations (
  code     text primary key,                     -- mandatory, career, officer, major, …
  name     text not null,
  priority int  not null default 100
);

create table day_types (
  code text primary key,                         -- weekday, weekend, holiday, holiday_eve, memorial
  name text not null
);

create table calendar_days (
  day         date primary key,
  day_type    text not null references day_types(code),
  source      text not null default 'manual' check (source in ('hebcal', 'manual')),
  note        text
);

create table duty_categories (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique                     -- קצין תורן, מפקד שער, משימות חיילות ועוד
);

create table task_types (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique,     -- stable id used by imports and the solver
  name                 text not null unique,
  category_id          uuid references duty_categories(id),
  weight               numeric(4,2) not null check (weight > 0),
  min_rest_hours       int  not null default 0 check (min_rest_hours >= 0),
  service_restriction  text not null default 'any' check (service_restriction in ('any', 'mandatory', 'career')),
  requires_weapon      boolean not null default false,
  is_weekend_type      boolean not null default false,   -- Shabbat variant: no weekend multiplier
  shachar_compatible   boolean not null default false,
  qualifying_duty      boolean not null default false,   -- ממלכ"ת יום
  eligible_populations text[] not null default '{}',     -- empty = everyone
  rank_min_id          uuid references ranks(id),
  rank_max_id          uuid references ranks(id),
  gender               gender_type,
  default_start_time   time,
  default_end_time     time,
  color                text,
  is_active            boolean not null default true
);

create table weight_history (
  id             bigserial primary key,
  task_type_id   uuid references task_types(id),
  multiplier_key text,                            -- weekend_multiplier etc. when not a task weight
  value          numeric(4,2) not null,
  effective_from date not null,
  changed_by     uuid,
  changed_at     timestamptz not null default now(),
  check ((task_type_id is null) <> (multiplier_key is null))
);

create table load_roles (
  id     uuid primary key default gen_random_uuid(),
  name   text not null unique,                    -- ראש צוות, כונן מבצעי
  factor numeric(3,2) not null check (factor > 0 and factor <= 1)
);

create table load_role_factor_history (
  id             bigserial primary key,
  load_role_id   uuid not null references load_roles(id),
  factor         numeric(3,2) not null,
  effective_from date not null,
  changed_by     uuid,
  changed_at     timestamptz not null default now()
);

create table absence_types (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null unique,
  counts_as_long_absence   boolean not null default false,
  requires_approval        boolean not null default false
);

create table exemption_types (
  id                          uuid primary key default gen_random_uuid(),
  name                        text not null unique,
  level                       text not null default 'official' check (level in ('official', 'internal')),
  qualifies_day_only          boolean not null default false,  -- holder may do ממלכ"ת יום only
  allows_partial_restriction  boolean not null default true,
  auto_rule                   jsonb                              -- computed exemptions, e.g. שח"ר
);

create table exemption_type_duties (
  exemption_type_id uuid not null references exemption_types(id) on delete cascade,
  task_type_id      uuid not null references task_types(id) on delete cascade,
  effect            text not null check (effect in ('excludes', 'qualifies')),
  primary key (exemption_type_id, task_type_id)
);

-- ---------------------------------------------------------------------------
-- Soldiers
-- ---------------------------------------------------------------------------
create table soldiers (
  id                       uuid primary key default gen_random_uuid(),
  soldier_key              text not null unique check (soldier_key ~ '^[0-9a-f]{64}$'),
  full_name                text not null,
  service_type             service_type not null,
  gender                   gender_type,
  gaf_id                   uuid not null references org_units(id),
  team_id                  uuid references org_units(id),
  enlistment_date          date,
  release_date             date,
  unit_join_date           date,
  computed_rank_id         uuid references ranks(id),          -- from the HR file
  appointment_rank_id      uuid references ranks(id),          -- manual override (סרן במינוי רס"ן)
  appointment_rank_until   date,
  range_valid_until        date,
  is_shachar               boolean not null default false,
  shachar_start_date       date,
  career_start_date        date,
  parent_status            boolean not null default false,
  parent_flag_source       text not null default 'file' check (parent_flag_source in ('file', 'manual')),
  parent_override          boolean,
  parent_override_reason   text,
  parent_override_until    date,
  second_role_signed_at    date,                               -- תפקיד שני – manual
  opening_score            numeric(8,2),
  opening_score_at         timestamptz,
  is_active                boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index on soldiers (gaf_id) where is_active;
create trigger soldiers_touch before update on soldiers for each row execute function app.touch_updated_at();
comment on column soldiers.soldier_key is 'HMAC-SHA256(personal number, unit key) in hex. The personal number itself is never stored.';

create table soldier_gaf_history (
  soldier_id uuid not null references soldiers(id) on delete cascade,
  gaf_id     uuid not null references org_units(id),
  valid_from date not null,
  valid_to   date,
  primary key (soldier_id, valid_from)
);

create table soldier_load_roles (
  soldier_id   uuid not null references soldiers(id) on delete cascade,
  load_role_id uuid not null references load_roles(id),
  valid_from   date not null,
  valid_to     date,
  primary key (soldier_id, load_role_id, valid_from)
);

-- ---------------------------------------------------------------------------
-- Users and roles (Supabase Auth owns passwords and TOTP)
-- ---------------------------------------------------------------------------
create table app_users (
  id                   uuid primary key,          -- = auth.users.id (FK added in the security migration)
  username             text not null unique check (username ~ '^[a-z0-9._-]{3,32}$'),
  soldier_id           uuid references soldiers(id),
  must_change_password boolean not null default true,
  is_locked            boolean not null default false,
  privacy_ack_at       timestamptz,
  last_login_at        timestamptz,
  created_at           timestamptz not null default now()
);

alter table org_units add constraint org_units_commander_fk
  foreign key (commander_user_id) references app_users(id);

create table user_roles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references app_users(id) on delete cascade,
  role         app_role not null,
  gaf_id       uuid references org_units(id),
  valid_from   timestamptz,
  valid_to     timestamptz,
  delegated_by uuid references app_users(id),
  created_at   timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to > valid_from),
  check (role <> 'deputy' or (valid_from is not null and valid_to is not null))  -- delegation is always bounded
);
create index on user_roles (user_id);

-- ---------------------------------------------------------------------------
-- Cycles, slots, assignments
-- ---------------------------------------------------------------------------
create table cycles (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  start_date         date not null,
  end_date           date not null check (end_date > start_date),
  exemption_deadline timestamptz,
  status             cycle_status not null default 'draft',
  published_at       timestamptz,
  published_by       uuid references app_users(id),
  created_at         timestamptz not null default now()
);

-- Frozen per-soldier facts for the cycle (rank, populations, baseline score…).
create table cycle_soldier_snapshot (
  cycle_id            uuid not null references cycles(id) on delete cascade,
  soldier_id          uuid not null references soldiers(id),
  rank_id             uuid references ranks(id),
  rank_order          int,
  populations         text[] not null,
  balance_population  text not null,
  is_parent           boolean not null,
  qualifies_day_only  boolean not null,
  is_shachar          boolean not null,
  baseline_score      numeric(8,2) not null,
  baseline_weekends   int not null,
  baseline_reserves   int not null,
  taken_at            timestamptz not null default now(),
  primary key (cycle_id, soldier_id)
);

create table slots (
  id                 uuid primary key default gen_random_uuid(),
  cycle_id           uuid not null references cycles(id) on delete cascade,
  task_type_id       uuid not null references task_types(id),
  starts_at          timestamptz not null,
  ends_at            timestamptz not null check (ends_at > starts_at),
  performers_needed  int not null default 1 check (performers_needed >= 0),
  reserves_needed    int not null default 1 check (reserves_needed >= 0),
  rank_min_id        uuid references ranks(id),
  rank_max_id        uuid references ranks(id),
  gender             gender_type,
  base_gaf_hint      uuid references org_units(id),        -- documentation only, never used to assign
  is_penalty_slot    boolean not null default false,
  penalty_id         uuid,                                 -- FK added after penalties
  report_at          timestamptz,
  report_place       text,
  briefing_at        timestamptz,
  briefing_place     text,
  equipment          text,
  contacts           jsonb,
  cancelled_at       timestamptz,
  version            int not null default 1,
  updated_at         timestamptz not null default now()
);
create index on slots (cycle_id, starts_at);
create trigger slots_touch before update on slots for each row execute function app.touch_updated_at();

create table assignments (
  id                       uuid primary key default gen_random_uuid(),
  slot_id                  uuid not null references slots(id) on delete cascade,
  soldier_id               uuid not null references soldiers(id),
  gaf_id                   uuid not null references org_units(id),     -- gaf at assignment time
  role                     assignment_role not null,
  status                   assignment_status not null default 'draft',
  is_penalty               boolean not null default false,
  points                   numeric(6,2) not null default 0,
  factor_at_time           numeric(3,2) not null default 1,
  normalized_points        numeric(8,2) not null default 0,
  weekend_units            int not null default 0,
  explanation              text,
  manual_reason            text,
  source                   assignment_source not null default 'solver',
  replaced_assignment_id   uuid references assignments(id),
  paired_assignment_id     uuid references assignments(id),           -- reserve ↔ performer
  phone_confirmed_at       timestamptz,
  phone_confirmed_by       uuid references app_users(id),
  on_behalf_of             uuid references app_users(id),
  received_via             received_via,
  received_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  check (source <> 'manual' or manual_reason is not null)
);
create index on assignments (slot_id);
create index on assignments (soldier_id, status);
create unique index assignments_one_active_role
  on assignments (slot_id, soldier_id)
  where status not in ('dropped', 'cancelled_approved', 'swapped_out');
create trigger assignments_touch before update on assignments for each row execute function app.touch_updated_at();

create table schedule_jobs (
  id           uuid primary key default gen_random_uuid(),
  cycle_id     uuid not null references cycles(id) on delete cascade,
  kind         job_kind not null default 'full',
  status       job_status not null default 'queued',
  params       jsonb not null default '{}',
  input        jsonb,
  result       jsonb,
  error        text,
  progress     smallint not null default 0,
  requested_by uuid references app_users(id),
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);

create table score_adjustments (
  id             uuid primary key default gen_random_uuid(),
  soldier_id     uuid not null references soldiers(id),
  points         numeric(8,2) not null,
  effective_date date not null,
  reason         text not null check (reason in ('new_soldier', 'return_from_absence', 'second_role', 'manual')),
  population     text references populations(code),
  note           text,
  created_by     uuid references app_users(id),
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Records entered for soldiers (in 1.0 by נע"ת on their behalf)
-- ---------------------------------------------------------------------------
create table exemptions (
  id                     uuid primary key default gen_random_uuid(),
  soldier_id             uuid not null references soldiers(id),
  exemption_type_id      uuid not null references exemption_types(id),
  kind                   text not null check (kind in ('full', 'partial')),
  start_date             date not null,
  end_date               date not null check (end_date >= start_date),
  excluded_task_type_ids uuid[],
  restricted_hours       text check (restricted_hours ~ '^\d{2}:\d{2}-\d{2}:\d{2}$'),
  is_urgent              boolean not null default false,
  status                 request_status not null default 'pending',
  source                 text not null default 'coordinator' check (source in ('soldier', 'coordinator', 'computed')),
  proof_checked_at       timestamptz,
  proof_checked_by       uuid references app_users(id),
  decided_by             uuid references app_users(id),
  decided_at             timestamptz,
  decision_reason        text,
  on_behalf_of           uuid references app_users(id),
  received_via           received_via,
  received_at            timestamptz,
  created_at             timestamptz not null default now(),
  -- an approved exemption needs the proof mark, except computed ones (no paper behind them)
  check (status <> 'approved' or source = 'computed' or proof_checked_at is not null),
  check (status <> 'rejected' or decision_reason is not null)
);
comment on table exemptions is 'No medical details: type, dates and "proof checked" only. Proof is examined outside the system.';

create table date_blocks (
  id           uuid primary key default gen_random_uuid(),
  soldier_id   uuid not null references soldiers(id),
  cycle_id     uuid references cycles(id),
  day          date not null,
  status       text not null default 'active' check (status in ('active', 'cancelled')),
  on_behalf_of uuid references app_users(id),
  received_via received_via,
  received_at  timestamptz,
  created_at   timestamptz not null default now()
);
-- one active block per soldier per calendar month (quota from settings is enforced in app.check_block_quota)
create unique index date_blocks_one_per_month
  on date_blocks (soldier_id, (date_trunc('month', day::timestamp)))
  where status = 'active';

create table absences (
  id              uuid primary key default gen_random_uuid(),
  soldier_id      uuid not null references soldiers(id),
  absence_type_id uuid not null references absence_types(id),
  starts_at       timestamptz not null,
  ends_at         timestamptz not null check (ends_at > starts_at),
  status          text not null default 'active' check (status in ('active', 'cancelled')),
  cancelled_by    uuid references app_users(id),
  cancel_reason   text,
  on_behalf_of    uuid references app_users(id),
  received_via    received_via,
  received_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index on absences (soldier_id, starts_at);

create table personal_constraints (
  id           uuid primary key default gen_random_uuid(),
  soldier_id   uuid not null references soldiers(id),
  task_type_id uuid references task_types(id),
  time_window  text check (time_window ~ '^\d{2}:\d{2}-\d{2}:\d{2}$'),
  reason       text not null,
  valid_until  date,
  created_by   uuid references app_users(id),
  created_at   timestamptz not null default now()
);

create table penalties (
  id                       uuid primary key default gen_random_uuid(),
  target_type              text not null check (target_type in ('soldier', 'gaf')),
  soldier_id               uuid references soldiers(id),
  gaf_id                   uuid references org_units(id),
  reason                   text not null check (reason in ('no_show', 'late')),
  base_reference           text,
  dropped_assignment_id    uuid references assignments(id),
  penalty_slot_id          uuid references slots(id),
  approved_by_gaf_commander uuid references app_users(id),   -- recorded by נע"ת in 1.0
  imposed_by               uuid references app_users(id),
  status                   text not null default 'recorded'
                           check (status in ('recorded', 'appealed_to_base', 'cancelled_by_base', 'served')),
  on_behalf_of             uuid references app_users(id),
  received_via             received_via,
  received_at              timestamptz,
  created_at               timestamptz not null default now(),
  check ((target_type = 'soldier') = (soldier_id is not null)),
  check ((target_type = 'gaf') = (gaf_id is not null))
);
alter table slots add constraint slots_penalty_fk foreign key (penalty_id) references penalties(id);

create table appeals (
  id                 uuid primary key default gen_random_uuid(),
  soldier_id         uuid not null references soldiers(id),
  subject_type       text not null check (subject_type in ('penalty', 'assignment')),
  subject_id         uuid not null,
  reason             text not null,
  status             text not null default 'open' check (status in ('open', 'accepted', 'rejected', 'forwarded_to_base')),
  due_at             timestamptz not null default now() + interval '72 hours',
  decided_by         uuid references app_users(id),
  decided_at         timestamptz,
  decision_reason    text,
  on_behalf_of       uuid references app_users(id),
  received_via       received_via,
  received_at        timestamptz,
  created_at         timestamptz not null default now(),
  check (status = 'open' or decision_reason is not null)
);

create table swap_requests (
  id                     uuid primary key default gen_random_uuid(),
  kind                   text not null default 'mutual' check (kind in ('mutual', 'handover')),
  assignment_id          uuid not null references assignments(id),
  requested_by           uuid not null references soldiers(id),
  target_soldier_id      uuid references soldiers(id),
  counter_assignment_id  uuid references assignments(id),
  approver_role          text not null default 'coordinator' check (approver_role in ('gaf_commander', 'coordinator')),
  status                 text not null default 'pending_approval'
                         check (status in ('open', 'pending_peer', 'pending_approval', 'approved', 'rejected', 'cancelled')),
  reserve_change         jsonb,
  decided_by             uuid references app_users(id),
  decision_reason        text,
  on_behalf_of           uuid references app_users(id),
  received_via           received_via,
  received_at            timestamptz,
  created_at             timestamptz not null default now()
);

create table gaf_constraint_submissions (
  id                     uuid primary key default gen_random_uuid(),
  cycle_id               uuid not null references cycles(id) on delete cascade,
  gaf_id                 uuid not null references org_units(id),
  representative_user_id uuid references app_users(id),
  status                 text not null default 'open' check (status in ('open', 'submitted', 'approved', 'late')),
  submitted_at           timestamptz,
  approved_by            uuid references app_users(id),       -- gaf commander, recorded by נע"ת in 1.0
  approved_at            timestamptz,
  on_behalf_of           uuid references app_users(id),
  received_via           received_via,
  received_at            timestamptz,
  unique (cycle_id, gaf_id)
);

create table draft_comments (
  id             uuid primary key default gen_random_uuid(),
  cycle_id       uuid not null references cycles(id) on delete cascade,
  slot_id        uuid references slots(id) on delete cascade,
  gaf_id         uuid references org_units(id),
  author_user_id uuid references app_users(id),
  text           text not null,
  status         text not null default 'open' check (status in ('open', 'handled')),
  on_behalf_of   uuid references app_users(id),
  received_via   received_via,
  received_at    timestamptz,
  created_at     timestamptz not null default now()
);

create table briefing_attendance (
  assignment_id uuid primary key references assignments(id) on delete cascade,
  attended      boolean not null,
  marked_by     uuid references app_users(id),
  marked_at     timestamptz not null default now(),
  on_behalf_of  uuid references app_users(id),
  received_via  received_via
);

-- ---------------------------------------------------------------------------
-- Files (import / export only – never medical)
-- ---------------------------------------------------------------------------
create table blobs (
  id          uuid primary key default gen_random_uuid(),
  storage_key text not null unique,
  category    text not null check (category in ('import', 'export')),
  mime        text not null,
  size_bytes  bigint not null,
  sha256      text not null,
  delete_at   timestamptz not null default now() + interval '90 days',
  created_by  uuid references app_users(id),
  created_at  timestamptz not null default now()
);

create table roster_imports (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('roster', 'history', 'base_slots', 'constraints')),
  blob_id        uuid references blobs(id),
  column_mapping jsonb,
  status         text not null default 'validating' check (status in ('validating', 'preview', 'applied', 'rejected')),
  summary        jsonb,
  uploaded_by    uuid references app_users(id),
  applied_by     uuid references app_users(id),
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Notifications (1.0: to נע"ת only)
-- ---------------------------------------------------------------------------
create table notifications (
  id                uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references app_users(id) on delete cascade,
  type              text not null,
  payload           jsonb not null default '{}',
  requires_ack      boolean not null default false,
  read_at           timestamptz,
  acked_at          timestamptz,
  created_at        timestamptz not null default now()
);
create index on notifications (recipient_user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Audit log – append only
-- ---------------------------------------------------------------------------
create table audit_log (
  id            bigserial primary key,
  actor_user_id uuid,
  on_behalf_of  uuid,
  action        text not null,
  entity_type   text not null,
  entity_id     text,
  before        jsonb,
  after         jsonb,
  at            timestamptz not null default now()
);
create index on audit_log (entity_type, entity_id);
create index on audit_log (at desc);

create table config_versions (
  id               bigserial primary key,
  entity_type      text not null,
  entity_id        text not null,
  before           jsonb,
  after            jsonb,
  effective_from   date,
  changed_by       uuid,
  changed_at       timestamptz not null default now(),
  reverted_from_id bigint references config_versions(id)
);
