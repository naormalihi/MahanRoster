-- "לוח התורנויות" is now "לוח השיבוצים": the texts in the notices the database sends
-- (board published, changes in the board…). Each function that says it is rebuilt with the new name.
do $$
declare f record;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('app', 'public') and p.prokind = 'f'
       and (p.prosrc like '%לוח התורנויות%' or p.prosrc like '%לוח תורנויות%')
  loop
    execute replace(replace(pg_get_functiondef(f.oid), 'לוח התורנויות', 'לוח השיבוצים'), 'לוח תורנויות', 'לוח שיבוצים');
  end loop;
end $$;
