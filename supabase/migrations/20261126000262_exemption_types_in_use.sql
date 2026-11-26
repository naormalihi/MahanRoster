-- =============================================================================
-- Exemption types in use (2.62.1): a type can be set aside (is_active = false). It stays for the
-- exemptions already saved with it – they keep working and show its name – but a new exemption,
-- or a change of type, can't use it. Unit decision 26.11: only "פטור מלא" and "פטור חלקי" stay;
-- the other types are deleted (no exemption uses them).
-- =============================================================================

alter table exemption_types add column if not exists is_active boolean not null default true;

-- the unit's catalog: only the two types (when both are there). A type no exemption uses is
-- deleted (its duty list goes with it); one still in use – if any – is only set aside.
do $$
begin
  if exists (select 1 from exemption_types where name = 'פטור מלא')
     and exists (select 1 from exemption_types where name = 'פטור חלקי') then
    delete from exemption_types t
    where t.name not in ('פטור מלא', 'פטור חלקי')
      and not exists (select 1 from exemptions e where e.exemption_type_id = t.id);
    update exemption_types set is_active = false where name not in ('פטור מלא', 'פטור חלקי');
  end if;
end $$;

create or replace function app.exemption_type_in_use() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (tg_op = 'INSERT' or new.exemption_type_id is distinct from old.exemption_type_id)
     and new.source is distinct from 'computed'
     and exists (select 1 from exemption_types t where t.id = new.exemption_type_id and not t.is_active) then
    raise exception 'סוג הפטור הזה כבר לא בשימוש';
  end if;
  return new;
end $$;

drop trigger if exists exemptions_type_in_use on exemptions;
create trigger exemptions_type_in_use before insert or update of exemption_type_id on exemptions
  for each row execute function app.exemption_type_in_use();

-- the employee's own request: only types in use
CREATE OR REPLACE FUNCTION public.my_input_options()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case when app.my_soldier() is null then null else jsonb_build_object(
    'exemption_types', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name,
                                                                     'requires_duty_list', t.requires_duty_list) order by t.name)
                                 from exemption_types t where t.auto_rule is null and t.is_active), '[]'),
    'eligible_tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
                                from task_types t where t.id = any(app.eligible_task_types(app.my_soldier()))), '[]'),
    'absence_types', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
                               from absence_types t where not t.requires_approval), '[]'),
    'block_quota_per_month', coalesce((app.setting('block_quota_per_month') #>> '{}')::int, 1),
    'cycles', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'start_date', c.start_date, 'end_date', c.end_date,
                                                            'deadline', c.exemption_deadline,
                                                            'open', c.status not in ('published', 'closed')
                                                                    and (c.exemption_deadline is null or c.exemption_deadline > now()))
                                         order by c.start_date)
                        from cycles c where c.end_date >= current_date), '[]')
  ) end
$function$;
