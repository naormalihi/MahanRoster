-- Wording: the overview says "N משימות" (duties from the base board), not "N משבצות".

create or replace function public.cycle_stages(p_cycle uuid)
returns table (stage cycle_status, tone text, note text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  c        cycles;
  roster   timestamptz;
  pending  int;
  nslots   int;
  job      text;
  d        text := 'DD/MM';
begin
  perform app.require_reader();
  select * into c from cycles where id = p_cycle;
  if not found then return; end if;
  select max(created_at) into roster from roster_imports where kind = 'roster' and status = 'applied' and created_at >= c.created_at;
  select count(*) into pending from exemptions e where e.status = 'pending' and e.start_date <= c.end_date and e.end_date >= c.start_date;
  select count(*) into nslots from slots where cycle_id = p_cycle and cancelled_at is null;
  select status::text into job from schedule_jobs where cycle_id = p_cycle and kind in ('full', 'stability') order by created_at desc limit 1;

  return query values
    ('draft'::cycle_status, 'done', 'נוצר ' || to_char(c.created_at at time zone app.tz(), d)),
    ('loading', case when roster is not null then 'done' else 'todo' end,
       case when roster is not null then 'נטען ' || to_char(roster at time zone app.tz(), d) else 'צריך לטעון קובץ כוח אדם עדכני' end),
    ('collecting', case when c.exemption_deadline is null then 'warn' when c.exemption_deadline <= now() then 'done' else 'todo' end,
       case when c.exemption_deadline is null then 'לא נקבע מועד סגירה'
            when c.exemption_deadline <= now() then 'נסגר ' || to_char(c.exemption_deadline at time zone app.tz(), d)
            else 'פתוח עד ' || to_char(c.exemption_deadline at time zone app.tz(), d) end),
    ('approving', case when pending > 0 then 'warn' when c.exemption_deadline <= now() then 'done' else 'todo' end,
       case when pending > 0 then pending || ' ממתינים' else 'אין ממתינים' end),
    ('potential', case when c.potential_computed_at is not null then 'done' else 'todo' end,
       case when c.potential_computed_at is not null then 'חושב ' || to_char(c.potential_computed_at at time zone app.tz(), d) else 'לא חושב' end),
    ('slots', case when nslots > 0 then 'done' else 'todo' end,
       case when nslots > 0 then nslots || ' משימות' else 'לא נקלט' end),
    ('scheduling', case when job in ('queued', 'running') then 'busy' when job = 'done' then 'done' when job = 'failed' then 'warn' else 'todo' end,
       case when job in ('queued', 'running') then 'רץ' when job = 'done' then 'הושלם' when job = 'failed' then 'נכשל' else 'לא הורץ' end),
    ('review', case when c.status in ('published', 'closed') then 'done' when job = 'done' then 'todo' else 'todo' end,
       case when c.status in ('published', 'closed') then 'אושרה' when job = 'done' then 'מחכה לבדיקה ולפרסום' else '' end),
    ('published', case when c.status in ('published', 'closed') then 'done' else 'todo' end,
       case when c.published_at is not null then 'פורסם ' || to_char(c.published_at at time zone app.tz(), d) else '' end),
    ('closed', case when c.status = 'closed' then 'done' else 'todo' end,
       'אחרי ' || to_char(c.end_date, d));
end $$;
