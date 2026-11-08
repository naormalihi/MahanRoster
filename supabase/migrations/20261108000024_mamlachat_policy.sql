-- =============================================================================
-- ממלכ"ת by the unit's policy slide (תורנויות + פטורים/הקלות):
--   ממלכ"ת לילה (חול) – רס"נים; official exemptions רפואי, קפ"ס.
--   ממלכ"ת יום (חול)  – only parents and holders of an exemption that qualifies for it
--                        (by the base's exemption key); not רס"נים.
-- ממלכ"ת יום keeps its qualifying-duty flag, so it stays open to parents, to holders of a
-- qualifying exemption type and to holders of an exemption mapped "qualifies" (פטור רפואי).
-- =============================================================================

update task_types set eligible_populations = '{}' where code = 'mamlachat_yom';
update task_types set eligible_populations = '{major}' where code = 'mamlachat_layla';
