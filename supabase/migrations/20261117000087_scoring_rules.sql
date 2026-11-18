-- "איך מחושב הניקוד": the rules behind the points, for everyone who signs in (soldiers too).
-- Soldiers cannot read task_types, score_multipliers or settings directly; this returns only
-- what explains the score – names, weights and additions – and nothing about any soldier.
create or replace function public.scoring_rules()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (app.can_read() or app.my_soldier() is not null or current_setting('role') in ('service_role', 'none')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', t.name, 'weight', t.weight,
               'includes_holidays', t.includes_holidays, 'weekend_type', t.is_weekend_type, 'category', dc.name)
             order by dc.name nulls last, t.weight desc, t.name)
      from task_types t left join duty_categories dc on dc.id = t.category_id
      where t.is_active and not t.is_special), '[]'::jsonb),
    'additions', coalesce((
      select jsonb_agg(jsonb_build_object('name', m.name, 'value', m.value) order by m.value desc, m.sort_order, m.name)
      from score_multipliers m where m.is_active and m.value > 0), '[]'::jsonb),
    'surprise_multiplier', coalesce((app.setting('surprise_multiplier') #>> '{}')::numeric, 1.5),
    'surprise_notice_hours', coalesce((app.setting('surprise_notice_hours') #>> '{}')::int, 72),
    'window_months', coalesce((app.setting('score_window_months') #>> '{}')::int, 6),
    'fairness_tolerance_pct', coalesce((app.setting('fairness_tolerance_pct') #>> '{}')::numeric, 20),
    'credit_min_days', coalesce((app.setting('credit_absence_min_days') #>> '{}')::int, 7),
    -- the absence types that count as "not by choice" (credited), by their names in the settings
    'credit_absences', coalesce((select jsonb_agg(a.name order by a.name) from absence_types a where a.credits_load), '[]'::jsonb)
  );
end $$;

revoke all on function public.scoring_rules() from public, anon;
grant execute on function public.scoring_rules() to authenticated, service_role;
