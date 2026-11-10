-- Changing a forgotten unit key without losing history. The browser loads the full roster with a
-- new key and matches it to the existing soldiers by name (a person approves every match); this
-- moves the approved soldiers to their new soldier_key and stores the new key's fingerprint, in
-- one transaction. Soldiers left unmatched keep their old key: the next load shows them as not in
-- the file. Both tables are audited, so the change is in the audit log.

create or replace function public.rekey_soldiers(p_pairs jsonb, p_check text) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform app.require_coordinator();
  if p_check is null or p_check !~ '^[0-9a-f]{64}$' then raise exception 'invalid key fingerprint'; end if;
  if jsonb_typeof(p_pairs) <> 'array' then raise exception 'pairs must be an array'; end if;
  if (select count(*) <> count(distinct x.id) or count(*) <> count(distinct x.key)
      from jsonb_to_recordset(p_pairs) as x(id uuid, key text)) then
    raise exception 'a soldier or a key appears twice';
  end if;

  update soldiers s set soldier_key = x.key
  from jsonb_to_recordset(p_pairs) as x(id uuid, key text)
  where s.id = x.id;
  get diagnostics n = row_count;

  insert into settings (key, value) values ('unit_key_check', to_jsonb(p_check))
  on conflict (key) do update set value = excluded.value;
  return n;
end $$;
revoke execute on function public.rekey_soldiers(jsonb, text) from anon, public;
grant execute on function public.rekey_soldiers(jsonb, text) to authenticated;
