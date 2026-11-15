-- A scheduling run that updates the current draft instead of starting from nothing.
-- (Its own migration: a new enum value cannot be used in the transaction that adds it.)
alter type job_kind add value if not exists 'update';
