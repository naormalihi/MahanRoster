-- =============================================================================
-- Mandatory guard duty is one weekly duty ("שמירות חובה", Wednesday 13:00 to
-- Wednesday 13:00): the unit sends a soldier for the week and the base decides the
-- post. The ש"ג type becomes "שמירות חובה" (same id, so aliases and slots already
-- pointing at it stay valid); the split types from the slides are deactivated and
-- can be turned back on in the settings screen. Weekend days inside the week get
-- the weekend multiplier as usual.
-- =============================================================================

update task_types
   set code = 'shmirot_chova', name = 'שמירות חובה', min_rest_hours = 24,
       default_start_time = '13:00', default_end_time = '13:00'
 where code = 'shag'
   and not exists (select 1 from task_types where name = 'שמירות חובה');

update task_types set is_active = false
 where code in ('shag_shabbat', 'migdalim', 'migdalim_shabbat', 'mitbach_shabbat');
