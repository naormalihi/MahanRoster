-- "נע"ת תורנויות" is now "אחראי שיבוצים": the texts the database shows (errors, notices,
-- contact labels). Each function that still says the old name is rebuilt with the new one.
do $$
declare
  f record;
  d text;
  q text;
  n text;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname in ('app', 'public') and p.prokind = 'f'
       and (p.prosrc like '%נע"ת%' or p.prosrc like '%נע״ת%')
  loop
    d := pg_get_functiondef(f.oid);
    foreach q in array array['"', '״'] loop
      n := 'נע' || q || 'ת';
      d := replace(d, n || ' התורנויות', 'אחראי השיבוצים');
      d := replace(d, n || ' תורנויות', 'אחראי שיבוצים');
      d := replace(d, 'ה' || n, 'אחראי השיבוצים');
      d := replace(d, n, 'אחראי השיבוצים');
    end loop;
    execute d;
  end loop;
end $$;
