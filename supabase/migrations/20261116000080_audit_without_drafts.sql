-- =============================================================================
-- The audit log stops recording the engine's drafts.
--
-- Every run of the engine deletes and writes hundreds of draft rows, and every one of them was
-- recorded in full: 75 thousand of the 79 thousand records in 11 days, 120 MB of a 142 MB
-- database (the free plan stops writing at 500 MB). A draft is a proposal, not a decision:
-- the run itself is recorded in schedule_jobs, and publishing records what was decided.
--
-- What is still recorded, as before: every change to a row that is or was published
-- (assigned, reserve, activated, dropped, done…), and every manual change, draft or not.
-- What is not: an engine draft written, rescored or deleted.
--
-- The records of engine drafts already in the log are removed once (the log is otherwise
-- append-only; its guard is lifted for this statement only). The workflow then compacts the
-- table so the space is returned.
-- =============================================================================

drop trigger if exists assignments_audit on public.assignments;

create trigger assignments_audit_insert after insert on public.assignments
  for each row when (new.status <> 'draft' or new.source = 'manual')
  execute function app.audit();
create trigger assignments_audit_update after update on public.assignments
  for each row when (old.status <> 'draft' or new.status <> 'draft' or new.source = 'manual' or old.source = 'manual')
  execute function app.audit();
create trigger assignments_audit_delete after delete on public.assignments
  for each row when (old.status <> 'draft' or old.source = 'manual')
  execute function app.audit();

create temp table removed_drafts as
select count(*) as n from audit_log l
where l.entity_type = 'assignments'
  and coalesce(l.before ->> 'status', 'draft') = 'draft'
  and coalesce(l.after ->> 'status', 'draft') = 'draft'
  and coalesce(l.before ->> 'source', '') <> 'manual'
  and coalesce(l.after ->> 'source', '') <> 'manual';

alter table audit_log disable trigger audit_log_no_update;
delete from audit_log l
where l.entity_type = 'assignments'
  and coalesce(l.before ->> 'status', 'draft') = 'draft'
  and coalesce(l.after ->> 'status', 'draft') = 'draft'
  and coalesce(l.before ->> 'source', '') <> 'manual'
  and coalesce(l.after ->> 'source', '') <> 'manual';
alter table audit_log enable trigger audit_log_no_update;

insert into audit_log (actor_user_id, action, entity_type, entity_id, after)
values (null, 'audit_cleanup', 'audit_log', null,
        jsonb_build_object('removed', (select n from removed_drafts),
                           'note', 'records of engine drafts removed; drafts are no longer recorded row by row'));

drop table removed_drafts;
