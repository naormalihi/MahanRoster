-- =============================================================================
-- "הצעה לשיפור": anyone signed in may send an idea, a problem or a remark about the app;
-- נע"ת, מ"מ and the unit commander read them on "הצעות ומשוב".
--
-- * feedback: kind, text (≤ 1000), the screen, version and device it came from. Sent without a
--   name, nothing ties it to the sender – not even his user id. A daily limit (5) is kept apart,
--   in feedback_quota, per user and day, with no link to the messages.
-- * Status: new → in_progress → done / wont, with an internal note. Marking done or wont tells a
--   named sender in the bell, with an optional line of reply.
-- * No notice on a new message – a count only (feedback_new_count).
-- =============================================================================

create table if not exists feedback (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  kind           text not null check (kind in ('idea', 'bug', 'note')),
  body           text not null check (length(btrim(body)) between 1 and 1000),
  sender_user_id uuid references app_users(id) on delete set null,   -- null when sent without a name
  sender_name    text,
  screen         text check (length(screen) <= 80),
  app_version    text check (length(app_version) <= 20),
  device         text check (device in ('phone', 'desktop')),
  status         text not null default 'new' check (status in ('new', 'in_progress', 'done', 'wont')),
  note           text check (length(note) <= 1000),
  reply          text check (length(reply) <= 300),
  handled_by     uuid references app_users(id) on delete set null,
  handled_at     timestamptz
);
create index if not exists feedback_status on feedback (status, created_at desc);
alter table feedback enable row level security;   -- through the functions below only

create table if not exists feedback_quota (
  user_id uuid not null references app_users(id) on delete cascade,
  day     date not null,
  n       int not null default 0,
  primary key (user_id, day)
);
alter table feedback_quota enable row level security;

create or replace function app.sees_feedback() returns boolean
language sql stable as $$ select app.is_staff() or app.is_unit_commander() $$;
grant execute on function app.sees_feedback() to authenticated;

create or replace function public.submit_feedback(p_kind text, p_body text, p_anonymous boolean,
                                                  p_screen text default null, p_version text default null, p_device text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  used int;
  nm text;
  fid uuid;
begin
  if uid is null or not exists (select 1 from app_users where id = uid and deleted_at is null and not is_locked) then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if coalesce(length(btrim(p_body)), 0) = 0 then raise exception 'כתוב מה תרצה לומר'; end if;
  if length(btrim(p_body)) > 1000 then raise exception 'עד 1,000 תווים'; end if;
  insert into feedback_quota (user_id, day, n) values (uid, (now() at time zone app.tz())::date, 1)
  on conflict (user_id, day) do update set n = feedback_quota.n + 1
  returning n into used;
  if used > 5 then raise exception 'אפשר לשלוח עד 5 הודעות ביום – נסה שוב מחר'; end if;
  if not coalesce(p_anonymous, false) then
    select coalesce(s.full_name, u.username) into nm from app_users u left join soldiers s on s.id = u.soldier_id where u.id = uid;
  end if;
  insert into feedback (kind, body, sender_user_id, sender_name, screen, app_version, device)
  values (p_kind, btrim(p_body), case when coalesce(p_anonymous, false) then null else uid end, nm,
          left(p_screen, 80), left(p_version, 20), case when p_device in ('phone', 'desktop') then p_device end)
  returning id into fid;
  return fid;
end $$;

create or replace function public.feedback_list(p_status text default null)
returns table (id uuid, created_at timestamptz, kind text, body text, sender_name text, anonymous boolean,
               screen text, app_version text, device text, status text, note text, reply text,
               handled_by_name text, handled_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select f.id, f.created_at, f.kind, f.body, f.sender_name, f.sender_name is null, f.screen, f.app_version, f.device,
         f.status, f.note, f.reply, h.username, f.handled_at
  from feedback f
  left join app_users h on h.id = f.handled_by
  where app.sees_feedback() and (p_status is null or f.status = p_status)
  order by (f.status = 'new') desc, f.created_at desc
  limit 500
$$;

create or replace function public.feedback_new_count() returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select case when app.sees_feedback() then (select count(*)::int from feedback where status = 'new') else 0 end
$$;

create or replace function public.update_feedback(p_id uuid, p_status text, p_note text default null, p_reply text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f feedback;
  closing boolean;
begin
  if not app.sees_feedback() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  select * into f from feedback where id = p_id for update;
  if f.id is null then raise exception 'ההודעה לא נמצאה'; end if;
  closing := p_status in ('done', 'wont') and f.status is distinct from p_status;
  update feedback
     set status = p_status, note = nullif(btrim(p_note), ''), reply = nullif(btrim(p_reply), ''),
         handled_by = auth.uid(), handled_at = now()
   where id = p_id;
  if closing and f.sender_user_id is not null then
    insert into notifications (recipient_user_id, type, payload)
    values (f.sender_user_id, 'feedback_reply', jsonb_build_object(
      'title', case p_status when 'done' then 'ההצעה שלך בוצעה – תודה!' else 'עדכון על ההודעה ששלחת' end,
      'body', coalesce(nullif(btrim(p_reply), ''), case p_status when 'done' then 'טיפלנו בזה.' else 'החלטנו לא לעשות את זה כרגע.' end)
              || ' («' || left(f.body, 60) || case when length(f.body) > 60 then '…' else '' end || '»)',
      'url', '/'));
  end if;
end $$;

revoke execute on function public.submit_feedback(text, text, boolean, text, text, text), public.feedback_list(text),
  public.feedback_new_count(), public.update_feedback(uuid, text, text, text) from public, anon;
grant execute on function public.submit_feedback(text, text, boolean, text, text, text), public.feedback_list(text),
  public.feedback_new_count(), public.update_feedback(uuid, text, text, text) to authenticated;
