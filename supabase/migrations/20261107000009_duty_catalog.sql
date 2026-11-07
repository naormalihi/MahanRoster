-- =============================================================================
-- Starting duty catalog, from the spec (קטלוג התורנויות והאוכלוסיות).
-- Everything here is editable by נע"ת; weights, hours and rest are a first draft.
--
--   * חול and שבת are separate types. A Shabbat type's weight is per day unit and
--     already includes the weekend premium (1.5 × the weekday weight), so the
--     weekend multiplier is not applied to it.
--   * Default start/end times fill slots imported with dates only.
--   * Soldier duties (ש"ג, מגדלים, מטבח, רס"ר) stop at סמ"ר: officers in mandatory
--     service do officer duties, not soldier guard duties.
-- =============================================================================

insert into duty_categories (name) values
  ('הגנ"ש'), ('קצין תורן'), ('מפקד שער'), ('ממלכ"ת'), ('שמירות חובה'), ('רס"ר'), ('משימות חיילות')
on conflict (name) do nothing;

with c as (select id, name from duty_categories),
     r as (select name, id from ranks)
insert into task_types (code, name, category_id, weight, min_rest_hours, service_restriction, requires_weapon,
                        is_weekend_type, shachar_compatible, qualifying_duty, eligible_populations,
                        rank_max_id, gender, default_start_time, default_end_time, color)
values
  -- career and officers
  ('hagnash',              'הגנ"ש',                 (select id from c where name = 'הגנ"ש'),        1.00, 24, 'any',       true,  false, false, false, '{career,officer}', (select id from r where name = 'סרן'), null, '08:00', '08:00', '#7a3e9d'),
  ('katzin_toran',         'קצין תורן – חול',       (select id from c where name = 'קצין תורן'),    1.00, 24, 'any',       false, false, false, false, '{career,officer}', null, null, '08:00', '08:00', '#2f7d5b'),
  ('katzin_toran_shabbat', 'קצין תורן – שבת',       (select id from c where name = 'קצין תורן'),    1.50, 24, 'any',       false, true,  false, false, '{career,officer}', null, null, '08:00', '08:00', '#2f7d5b'),
  ('k_haganak_shabbat',    'ק. הגנ"ק – שבת',        (select id from c where name = 'קצין תורן'),    1.50, 24, 'any',       true,  true,  false, false, '{career,officer}', null, null, '08:00', '08:00', '#3f8f6b'),
  ('mefaked_shaar',        'מפקד שער – חול',        (select id from c where name = 'מפקד שער'),     1.00, 24, 'any',       true,  false, false, false, '{career,officer}', null, null, '08:00', '08:00', '#9a6a1f'),
  ('mefaked_shaar_shabbat','מפקד שער – שבת',        (select id from c where name = 'מפקד שער'),     1.50, 24, 'any',       true,  true,  false, false, '{career,officer}', null, null, '08:00', '08:00', '#9a6a1f'),
  ('mamlachat_layla',      'ממלכ"ת לילה – חול',     (select id from c where name = 'ממלכ"ת'),      1.00, 12, 'any',       false, false, false, false, '{major}',          null, null, '20:00', '08:00', '#4a5a8a'),
  ('mamlachat_yom',        'ממלכ"ת יום – חול',      (select id from c where name = 'ממלכ"ת'),      0.75,  0, 'any',       false, false, true,  true,  '{}',               null, null, '08:00', '17:00', '#6a7ab0'),
  -- mandatory service
  ('shag',                 'ש"ג – חול',             (select id from c where name = 'שמירות חובה'), 1.00, 24, 'mandatory', true,  false, false, false, '{mandatory}',      (select id from r where name = 'סמ"ר'), null, '13:00', '13:00', '#3b6ea8'),
  ('shag_shabbat',         'ש"ג – שבת',             (select id from c where name = 'שמירות חובה'), 1.50, 24, 'mandatory', true,  true,  false, false, '{mandatory}',      (select id from r where name = 'סמ"ר'), null, '13:00', '13:00', '#3b6ea8'),
  ('migdalim',             'מגדלים – חול',          (select id from c where name = 'שמירות חובה'), 1.00, 12, 'mandatory', true,  false, false, false, '{mandatory}',      (select id from r where name = 'סמ"ר'), null, '20:00', '08:00', '#5a4fa0'),
  ('migdalim_shabbat',     'מגדלים – שבת',          (select id from c where name = 'שמירות חובה'), 1.50, 12, 'mandatory', true,  true,  false, false, '{mandatory}',      (select id from r where name = 'סמ"ר'), null, '20:00', '08:00', '#5a4fa0'),
  ('mitbach_shabbat',      'מטבח – שבת',            (select id from c where name = 'שמירות חובה'), 1.50, 24, 'mandatory', false, true,  false, false, '{mandatory}',      (select id from r where name = 'סמ"ר'), null, '12:00', '20:00', '#a04f5e'),
  ('rasar',                'רס"ר – חול',            (select id from c where name = 'רס"ר'),        0.75, 12, 'mandatory', false, false, false, false, '{mandatory}',      (select id from r where name = 'סמ"ר'), null, '08:00', '17:00', '#6b6b6b'),
  ('rasar_shabbat',        'רס"ר – שבת',            (select id from c where name = 'רס"ר'),        1.25, 12, 'mandatory', false, true,  false, false, '{mandatory}',      (select id from r where name = 'סמ"ר'), null, '08:00', '17:00', '#6b6b6b'),
  ('mesimot_chayalot',     'משימות חיילות',         (select id from c where name = 'משימות חיילות'), 1.00, 12, 'any',     false, false, false, false, '{}',               null, 'female', '08:00', '17:00', '#b05c8a')
on conflict (code) do nothing;

-- Exemption types from the spec, and which duties each one exempts from.
insert into exemption_types (name, level) values
  ('רפואי', 'official'), ('קפ"ס', 'official'), ('שח"ר', 'official'), ('משפחה שכולה', 'official')
on conflict (name) do nothing;

insert into exemption_type_duties (exemption_type_id, task_type_id, effect)
select et.id, tt.id, 'excludes'
from exemption_types et
join task_types tt on
     (et.name = 'רפואי')
  or (et.name = 'קפ"ס' and tt.code <> 'hagnash')
  or (et.name = 'שח"ר' and (tt.code = 'hagnash' or tt.service_restriction = 'mandatory'))
  or (et.name = 'משפחה שכולה' and tt.code = 'hagnash')
on conflict do nothing;
