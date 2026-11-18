-- =============================================================================
-- Neutral rank names (no military ranks on screen or in the data).
--
-- Each rank is a group and a number: חובה 1–4, מקצועי 1–5, מוביל 1–3, אקדמאי 1–2, בכיר 1–3.
-- The military name stays only as an alias, so the files from the base (personnel, base
-- schedule) are still read: "סמל - רס"ל" or "רס"ן" maps to the neutral name.
-- ranks.in_duties: the ranks that do duties are offered when choosing ranks for a duty;
-- the others (מקצועי 2–5, בכיר 2–3) only when already chosen.
-- =============================================================================

alter table ranks add column if not exists aliases text[] not null default '{}';
alter table ranks add column if not exists in_duties boolean not null default true;

with m (old, new, duties) as (values
  ('טוראי', 'חובה 1', true), ('רב"ט', 'חובה 2', true), ('סמל', 'חובה 3', true), ('סמ"ר', 'חובה 4', true),
  ('רס"ל', 'מקצועי 1', true), ('רס"ר', 'מקצועי 2', false), ('רס"מ', 'מקצועי 3', false),
  ('רס"ב', 'מקצועי 4', false), ('רנ"ג', 'מקצועי 5', false),
  ('סג"מ', 'מוביל 1', true), ('סגן', 'מוביל 2', true), ('סרן', 'מוביל 3', true),
  ('קמ"א', 'אקדמאי 1', true), ('קא"ב', 'אקדמאי 2', true),
  ('רס"ן', 'בכיר 1', true), ('סא"ל', 'בכיר 2', false), ('אל"ם', 'בכיר 3', false))
update ranks r set
  aliases = (select array_agg(distinct a) from unnest(r.aliases || array[r.name, r.short_name]) a
             where a is not null and a <> '' and a <> m.new),
  name = m.new,
  short_name = m.new,
  in_duties = m.duties
from m
where r.name = m.old;

update populations set name = 'מובילים' where code = 'officer' and name = 'קצינים';
update populations set name = 'בכירים' where code = 'major' and name = 'רס"ן ומעלה';
