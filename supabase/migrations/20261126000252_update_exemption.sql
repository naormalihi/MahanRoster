-- =============================================================================
-- Editing an exemption (2.61): staff change type, dates, scope (duties / hours) and the internal
-- note of a pending or approved exemption.
--   * An approved one stays approved. A change of type on an approved one needs the proof checked
--     again (p_proof_rechecked) – the check date is renewed.
--   * Widening it after publishing releases the employee's duties in the new scope, as approving
--     does (on_exemption_approved now also reacts to a change of type or scope). Narrowing returns
--     nothing by itself.
--   * The employee is told when an approved exemption changes (type, dates or scope) – never the note.
-- =============================================================================

create or replace function app.on_exemption_approved() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved'
                                  or old.start_date <> new.start_date or old.end_date <> new.end_date
                                  or old.exemption_type_id is distinct from new.exemption_type_id
                                  or old.kind is distinct from new.kind
                                  or old.excluded_task_type_ids is distinct from new.excluded_task_type_ids
                                  or old.restricted_hours is distinct from new.restricted_hours) then
    perform app.release_for_exemption(new.id);
  end if;
  return null;
end $$;

create or replace function public.update_exemption(
  p_id uuid, p_type uuid, p_start date, p_end date, p_kind text,
  p_tasks uuid[] default null, p_hours text default null, p_note text default null,
  p_proof_rechecked boolean default false
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e exemptions;
  et exemption_types;
  k text;
  changed boolean;
begin
  perform app.require_staff();
  select * into e from exemptions where id = p_id for update;
  if not found then raise exception 'הפטור לא נמצא'; end if;
  if e.status not in ('pending', 'approved') then raise exception 'אפשר לערוך רק פטור ממתין או מאושר'; end if;
  select * into et from exemption_types where id = p_type;
  if not found then raise exception 'סוג הפטור לא נמצא'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'תאריך הסיום לפני תאריך ההתחלה'; end if;
  if length(coalesce(p_note, '')) > 200 then raise exception 'הערה פנימית – עד 200 תווים'; end if;
  k := case when et.requires_duty_list then 'partial' when p_kind = 'partial' then 'partial' else 'full' end;
  if e.status = 'approved' and p_type <> e.exemption_type_id and not p_proof_rechecked and e.source <> 'computed' then
    raise exception 'סוג הפטור השתנה – צריך לבדוק את האסמכתא לסוג החדש';
  end if;

  changed := p_type <> e.exemption_type_id or p_start <> e.start_date or p_end <> e.end_date
             or k <> e.kind
             or (case when k = 'partial' then nullif(p_tasks, '{}') end) is distinct from e.excluded_task_type_ids
             or (case when k = 'partial' then nullif(trim(p_hours), '') end) is distinct from e.restricted_hours;

  update exemptions set
    exemption_type_id = p_type,
    start_date = p_start,
    end_date = p_end,
    kind = k,
    excluded_task_type_ids = case when k = 'partial' then nullif(p_tasks, '{}') end,
    restricted_hours = case when k = 'partial' then nullif(trim(p_hours), '') end,
    internal_note = nullif(trim(coalesce(p_note, '')), ''),
    proof_checked_at = case when p_proof_rechecked and p_type <> e.exemption_type_id then now() else proof_checked_at end,
    proof_checked_by = case when p_proof_rechecked and p_type <> e.exemption_type_id then auth.uid() else proof_checked_by end
  where id = p_id;

  if e.status = 'approved' and changed then
    perform app.notify_soldier(e.soldier_id, 'exemption_updated', 'הפטור שלך עודכן',
      et.name || ', ' || to_char(p_start, 'DD/MM') || '–' || to_char(p_end, 'DD/MM'),
      '/requests', jsonb_build_object('exemption_id', p_id));
  end if;
end $$;

revoke execute on function public.update_exemption(uuid, uuid, date, date, text, uuid[], text, text, boolean) from public, anon;
grant execute on function public.update_exemption(uuid, uuid, date, date, text, uuid[], text, text, boolean) to authenticated;
