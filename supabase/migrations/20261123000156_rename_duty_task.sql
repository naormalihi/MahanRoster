-- "תורנות / תורנויות" is now "משימה / משימות" in what the database says: errors, notices,
-- generated labels. Each function that still says the old word is rebuilt with the new one
-- (as a construct – "תורנות חג" → "משימת חג"). Names people typed (task types, settings) stay.
do $$
declare f record;
  d text;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname in ('app', 'public') and p.prokind = 'f' and p.prosrc like '%תורנ%'
  loop
    d := pg_get_functiondef(f.oid);
    d := regexp_replace(d, '(^|[^א-ת])([ושבלמכ]*)תורנות (חג|שבת|מחר|מרלו|סוף|לילה)', '\1\2משימת \3', 'g');
    d := replace(replace(d, 'תורנויות', 'משימות'), 'תורנות', 'משימה');
    execute d;
  end loop;
end $$;

-- the group label the snapshot keeps ("ללא תורנות פתוחה") – as the functions now write it
update cycle_soldier_snapshot set fairness_label = replace(fairness_label, 'ללא תורנות פתוחה', 'ללא משימה פתוחה')
 where fairness_label like '%ללא תורנות פתוחה%';
