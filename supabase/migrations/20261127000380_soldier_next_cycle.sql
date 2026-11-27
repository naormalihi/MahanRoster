-- =============================================================================
-- "המחזור הבא" for the employee (2.72): the cycle after today's – three steps (requests open /
-- the board being prepared / published) and his requests for it – and two reminders before the
-- requests close.
--   * my_input_options: each cycle also says whether it is published, and when.
--   * app.queue_deadline_reminders (in notify_tick): 3 days before the deadline, and on its morning,
--     to every active employee with an account – once per cycle each.
-- =============================================================================

alter table cycles add column if not exists deadline_reminded_3d timestamptz,
                   add column if not exists deadline_reminded_day timestamptz;

create or replace function app.queue_deadline_reminders() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n int := 0;
  c cycles;
  s record;
  local_now timestamp := now() at time zone app.tz();
  is_day boolean;
  body text;
begin
  for c in
    select * from cycles
    where status not in ('published', 'closed') and exemption_deadline is not null and exemption_deadline > now()
      and exemption_deadline <= now() + interval '3 days'
      and (deadline_reminded_3d is null or deadline_reminded_day is null)
  loop
    is_day := (c.exemption_deadline at time zone app.tz())::date = local_now::date;
    -- 3 days before: once (in the day, not at night); on the deadline's morning: once, from 08:00
    if is_day and c.deadline_reminded_day is null and local_now::time >= time '08:00' then
      body := 'היום אחרון להגיש פטור, היעדרות או חסימה ל' || c.name || ' – עד ' || to_char(c.exemption_deadline at time zone app.tz(), 'HH24:MI') || '.';
      for s in select so.id from soldiers so where so.is_active and (so.release_date is null or so.release_date >= c.start_date) loop
        n := n + app.notify_soldier(s.id, 'deadline_reminder', 'היום אחרון להגשת בקשות', body, '/requests', jsonb_build_object('cycle_id', c.id, 'kind', 'day'));
      end loop;
      update cycles set deadline_reminded_day = now(), deadline_reminded_3d = coalesce(deadline_reminded_3d, now()) where id = c.id;
    elsif not is_day and c.deadline_reminded_3d is null and local_now::time between time '09:00' and time '21:00' then
      body := 'אפשר להגיש פטור, היעדרות או חסימה ל' || c.name || ' עד ' || to_char(c.exemption_deadline at time zone app.tz(), 'DD/MM HH24:MI') || '.';
      for s in select so.id from soldiers so where so.is_active and (so.release_date is null or so.release_date >= c.start_date) loop
        n := n + app.notify_soldier(s.id, 'deadline_reminder', 'נשארו ' || greatest(1, ceil(extract(epoch from c.exemption_deadline - now()) / 86400))::int || ' ימים להגשת בקשות', body, '/requests', jsonb_build_object('cycle_id', c.id, 'kind', '3d'));
      end loop;
      update cycles set deadline_reminded_3d = now() where id = c.id;
    end if;
  end loop;
  return n;
end $$;
revoke all on function app.queue_deadline_reminders() from public, anon, authenticated;

CREATE OR REPLACE FUNCTION app.notify_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare queued int; acks int; ranges int; deadlines int; waiting int; woke boolean := false;
begin
  queued := app.queue_reminders();   -- its inserts wake the workflow through the trigger
  acks := app.queue_ack_reminders(); -- "עוד לא אישרת" and the gaf commander's notice
  ranges := app.queue_range_reminders();
  deadlines := app.queue_deadline_reminders();
  select count(*) into waiting
    from notifications n
   where n.pushed_at is null and n.created_at > now() - interval '2 days' and n.created_at < now() - interval '1 minute'
     and exists (select 1 from push_subscriptions p where p.user_id = n.recipient_user_id);
  if waiting > 0 then woke := app.wake_notify(); end if;
  return jsonb_build_object('reminders', queued, 'acks', acks, 'ranges', ranges, 'deadlines', deadlines, 'waiting', waiting, 'woke', woke);
end $function$;

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
                                                            'published', c.status in ('published', 'closed'), 'published_at', c.published_at,
                                                            'open', c.status not in ('published', 'closed')
                                                                    and (c.exemption_deadline is null or c.exemption_deadline > now()))
                                         order by c.start_date)
                        from cycles c where c.end_date >= current_date), '[]')
  ) end
$function$;
