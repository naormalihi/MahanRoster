-- "איך מחושב הניקוד": the relief roles and their factors.
CREATE OR REPLACE FUNCTION public.scoring_rules()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    'credit_absences', coalesce((select jsonb_agg(a.name order by a.name) from absence_types a where a.credits_load), '[]'::jsonb),
    -- relief roles (כונן, מוביל…): a role's points are divided by its factor
    'load_roles', coalesce((select jsonb_agg(jsonb_build_object('name', l.name, 'factor', l.factor) order by l.factor, l.name)
                            from load_roles l where l.factor < 1), '[]'::jsonb)
  );
end $function$;
