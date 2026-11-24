-- A score correction has no cap of its own: a high opening score is a correction too.
CREATE OR REPLACE FUNCTION public.add_score_correction(p_soldier uuid, p_cycle uuid, p_points numeric, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c cycles;
  eff date;
  rid uuid;
  why text := nullif(btrim(p_reason), '');
begin
  perform app.require_staff();
  select * into c from cycles where id = p_cycle;
  if not found then raise exception 'המחזור לא נמצא'; end if;
  if not exists (select 1 from soldiers where id = p_soldier) then raise exception 'העובד לא נמצא'; end if;
  if p_points is null or p_points = 0 then raise exception 'תיקון של 0 לא משנה כלום'; end if;
  -- no cap of its own (a high opening score is fine) – only what the column holds
  if abs(p_points) >= 1000000 then raise exception 'תיקון – עד 999,999 נקודות'; end if;
  if why is null then raise exception 'כתוב סיבה לתיקון'; end if;
  if length(why) > 200 then raise exception 'סיבה – עד 200 תווים'; end if;
  eff := c.start_date - 1;
  insert into score_adjustments (soldier_id, points, effective_date, reason, note, created_by, cycle_id)
  values (p_soldier, round(p_points, 2), eff, 'manual', why, auth.uid(), p_cycle)
  returning id into rid;
  perform app.apply_score_correction(p_soldier, eff, round(p_points, 2));
  return rid;
end $function$;
