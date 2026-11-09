-- Relief roles (מקדמי הקלה) are managed on the scoring settings screen.
-- * A second built-in role: כונן מבצעי, 0.7 (ראש צוות stays 0.5).
-- * A soldier with several roles gets the largest relief – the lowest factor – never a product
--   (as the engine and app.slot_points already do: min(factor)).
-- * Every factor change is kept in load_role_factor_history.
-- * delete_load_role: only a role no soldier has (otherwise its history would lose its meaning).

insert into load_roles (name, factor) values ('ראש צוות', 0.5), ('כונן מבצעי', 0.7)
on conflict (name) do nothing;

create or replace function app.log_load_role_factor() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' or new.factor is distinct from old.factor then
    insert into load_role_factor_history (load_role_id, factor, effective_from, changed_by)
    values (new.id, new.factor, current_date, auth.uid());
  end if;
  return null;
end $$;
drop trigger if exists load_roles_factor_history on load_roles;
create trigger load_roles_factor_history after insert or update on load_roles
  for each row execute function app.log_load_role_factor();
insert into load_role_factor_history (load_role_id, factor, effective_from)
select id, factor, current_date from load_roles lr
where not exists (select 1 from load_role_factor_history h where h.load_role_id = lr.id);

create or replace function public.delete_load_role(p_role uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform app.require_coordinator();
  select count(distinct soldier_id) into n from soldier_load_roles where load_role_id = p_role;
  if n > 0 then
    raise exception 'ל-% חיילים יש את ההקלה הזו, ולכן אי אפשר למחוק אותה. הסר אותה מהם קודם.', n;
  end if;
  delete from load_role_factor_history where load_role_id = p_role;
  delete from load_roles where id = p_role;
end $$;
revoke execute on function public.delete_load_role(uuid) from anon, public;
grant execute on function public.delete_load_role(uuid) to authenticated;
