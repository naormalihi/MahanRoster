-- ת"ש 7 (must sleep at home) is entered as an exemption type, not on the soldier's card.
--
-- * exemption_types.home_nightly: an exemption of such a type keeps the soldier out of every
--   duty that covers night hours, for its dates. It is stored as a partial exemption limited to
--   the night window (all duties), so the engine, the potential, the candidates of a slot and the
--   availability credit already treat it right.
-- * app.home_nightly_on also counts such an exemption (the potential's overnight rule and the
--   engine's preference for "ת"ש 7" slots).
-- * The manual "ת"ש 7" override on the soldier card is moved into exemptions and cleared.

alter table exemption_types add column if not exists home_nightly boolean not null default false;
insert into exemption_types (name, level, home_nightly, allows_partial_restriction)
values ('ת"ש 7 – לינה בבית', 'internal', true, false)
on conflict (name) do update set home_nightly = true;

create or replace function app.exemption_home_nightly() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from exemption_types where id = new.exemption_type_id and home_nightly) then
    new.kind := 'partial';
    new.excluded_task_type_ids := null;
    new.restricted_hours := coalesce(new.restricted_hours, app.setting('night_window') #>> '{}', '22:00-06:00');
  end if;
  return new;
end $$;
drop trigger if exists exemptions_home_nightly on exemptions;
create trigger exemptions_home_nightly before insert or update on exemptions
  for each row execute function app.exemption_home_nightly();

create or replace function app.home_nightly_on(s soldiers, on_day date) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case when s.home_nightly_override is not null
               and (s.home_nightly_override_until is null or s.home_nightly_override_until >= on_day)
              then s.home_nightly_override else s.home_nightly end
      or exists (select 1 from exemptions e join exemption_types t on t.id = e.exemption_type_id
                 where e.soldier_id = s.id and t.home_nightly and e.status = 'approved'
                   and e.start_date <= on_day and e.end_date >= on_day)
$$;

-- manual "yes" overrides become exemptions
insert into exemptions (soldier_id, exemption_type_id, kind, start_date, end_date, status, source,
                        proof_checked_at, decided_at, decision_reason, received_via, received_at)
select s.id, (select id from exemption_types where home_nightly limit 1), 'partial',
       current_date, coalesce(s.home_nightly_override_until, current_date + 365), 'approved', 'coordinator',
       now(), now(), coalesce(s.home_nightly_override_reason, 'הועבר מכרטיס החייל'), 'system', now()
from soldiers s
where s.home_nightly_override is true
  and (s.home_nightly_override_until is null or s.home_nightly_override_until >= current_date);
update soldiers set home_nightly_override = null, home_nightly_override_reason = null, home_nightly_override_until = null
where home_nightly_override is true;
