-- =============================================================================
-- Reference data every unit starts with. All of it is editable later.
-- =============================================================================

insert into populations (code, name, priority) values
  ('mandatory', 'חובה', 10),
  ('career',    'קבע', 20),
  ('officer',   'קצינים', 30),
  ('major',     'רס"ן ומעלה', 40)
on conflict (code) do nothing;

insert into day_types (code, name) values
  ('weekday',     'חול'),
  ('weekend',     'סופ"ש'),
  ('holiday',     'חג'),
  ('holiday_eve', 'ערב חג'),
  ('memorial',    'יום זיכרון')
on conflict (code) do nothing;

-- sort_order drives rank ranges; population_tags add officer / major populations.
insert into ranks (name, short_name, sort_order, population_tags) values
  ('טוראי',        'טור''',   1, '{}'),
  ('רב"ט',         'רב"ט',    2, '{}'),
  ('סמל',          'סמל',     3, '{}'),
  ('סמ"ר',         'סמ"ר',    4, '{}'),
  ('רס"ל',         'רס"ל',    5, '{}'),
  ('רס"ר',         'רס"ר',    6, '{}'),
  ('רס"מ',         'רס"מ',    7, '{}'),
  ('רס"ב',         'רס"ב',    8, '{}'),
  ('רנ"ג',         'רנ"ג',    9, '{}'),
  ('סג"מ',         'סג"מ',   10, '{officer}'),
  ('סגן',          'סגן',    11, '{officer}'),
  ('סרן',          'סרן',    12, '{officer}'),
  ('רס"ן',         'רס"ן',   13, '{officer,major}'),
  ('סא"ל',         'סא"ל',   14, '{officer,major}'),
  ('אל"ם',         'אל"ם',   15, '{officer,major}'),
  ('אזרח עובד צה"ל', 'אע"צ', 50, '{}')
on conflict (name) do nothing;

insert into load_roles (name, factor) values
  ('ראש צוות', 0.5)
on conflict (name) do nothing;

insert into absence_types (name, counts_as_long_absence, requires_approval) values
  ('חופשה', false, false),
  ('קורס', true, false),
  ('יציאה לחו"ל', false, false),
  ('מחלה', false, false),
  ('אחר', false, false)
on conflict (name) do nothing;

insert into exemption_types (name, level, qualifies_day_only) values
  ('פטור מלא', 'official', false),
  ('פטור חלקי', 'official', false),
  ('פטור מזכה – ממלכ"ת יום בלבד', 'official', true)
on conflict (name) do nothing;
