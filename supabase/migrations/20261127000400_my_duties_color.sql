-- 2.73.0: the duty type's color on the employee's own duties (the stripe beside each duty)
drop function if exists public.my_duties();

CREATE OR REPLACE FUNCTION public.my_duties()
 RETURNS TABLE(assignment_id uuid, cycle_id uuid, cycle_name text, task_name text, starts_at timestamp with time zone, ends_at timestamp with time zone, role assignment_role, status assignment_status, points numeric, explanation text, report_at timestamp with time zone, report_place text, briefing_at timestamp with time zone, briefing_place text, equipment text, briefing_by_call boolean, contact_name text, contact_phone text, briefing_note text, acked_at timestamp with time zone, note text, task_color text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select a.id, c.id, c.name, coalesce(sl.special_name, t.name), sl.starts_at, sl.ends_at, a.role, a.status, a.normalized_points, a.explanation,
         coalesce(sl.report_at, case when b.kind = 'report' then b.at end),
         coalesce(sl.report_place, case when b.kind = 'report' then b.place end),
         coalesce(sl.briefing_at, case when b.kind = 'briefing' then b.at end),
         coalesce(sl.briefing_place, case when b.kind in ('briefing', 'by_call') then b.place end),
         sl.equipment,
         coalesce(b.kind = 'by_call' and sl.briefing_at is null, false),
         b.contact_name, b.contact_phone, b.note, a.acked_at, sl.instructions, t.color
  from assignments a
  join slots sl on sl.id = a.slot_id
  join cycles c on c.id = sl.cycle_id and c.status in ('published', 'closed')
  join task_types t on t.id = sl.task_type_id
  left join lateral app.slot_brief(sl.id) b on true
  where a.soldier_id = app.my_soldier()
    and a.status not in ('draft', 'dropped', 'swapped_out', 'cancelled_approved')
    and sl.cancelled_at is null
  order by sl.starts_at
$function$;

revoke execute on function public.my_duties() from public, anon;
grant execute on function public.my_duties() to authenticated;
