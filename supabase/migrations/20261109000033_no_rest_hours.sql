-- Rest hours after a duty are not a rule in this unit: every duty type gets 0, and the field is
-- no longer shown. (The column and the engine's rest check stay; with 0 only overlaps count.)
update task_types set min_rest_hours = 0 where min_rest_hours <> 0;
