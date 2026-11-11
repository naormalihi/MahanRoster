-- Undo of 49 (reverted): the ת"ש 7 list per cycle for the draft's soldiers view is not used.
drop function if exists public.cycle_home_nightly(uuid);
