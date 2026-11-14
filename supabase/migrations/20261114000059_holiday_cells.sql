-- =============================================================================
-- The "multiplier per holiday day" table is edited directly: each cell (a holiday and a day
-- of it) is a multiplier of its own, marked holiday_cell. They are ordinary multipliers for
-- the points (the highest that applies still wins); the settings list shows them in the table,
-- not among the general ones.
-- =============================================================================

alter table score_multipliers add column if not exists holiday_cell boolean not null default false;
alter table score_multipliers drop constraint if exists score_multipliers_holiday_cell_shape;
alter table score_multipliers add constraint score_multipliers_holiday_cell_shape check (
  not holiday_cell or (cardinality(holidays) = 1 and cardinality(holiday_kinds) = 1 and cardinality(day_types) = 0
                       and cardinality(weekdays) = 0 and time_window is null and date_from is null and date_to is null));
create unique index if not exists score_multipliers_one_per_cell
  on score_multipliers ((holidays[1]), (holiday_kinds[1])) where holiday_cell;
