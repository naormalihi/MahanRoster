-- =============================================================================
-- Duty categories: editable names.
--
-- * The category ממלכ"ת is written without the gershayim, as the duty itself is
--   (ממלכת יום / לילה).
-- * The coordinator renames and adds categories from the duty catalog in the app.
--   Staff could already write the table (RLS staff_all); a name must be non-blank,
--   and every change goes to the audit log like the rest of the catalog.
-- =============================================================================

update duty_categories set name = 'ממלכת'
 where name = 'ממלכ"ת' and not exists (select 1 from duty_categories where name = 'ממלכת');

alter table duty_categories drop constraint if exists duty_categories_name_not_blank;
alter table duty_categories add constraint duty_categories_name_not_blank check (btrim(name) <> '');

drop trigger if exists duty_categories_audit on duty_categories;
create trigger duty_categories_audit after insert or update or delete on duty_categories
  for each row execute function app.audit();
