-- "שליחת התראת ניסיון" in the account screen: a notice to oneself, pushed now.
create or replace function public.send_test_notification() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if exists (select 1 from notifications where recipient_user_id = auth.uid() and type = 'test'
              and created_at > now() - interval '1 minute') then
    raise exception 'כבר נשלחה התראת ניסיון – נסה שוב בעוד דקה';
  end if;
  insert into notifications (recipient_user_id, type, payload)
  values (auth.uid(), 'test', jsonb_build_object('title', 'התראת ניסיון', 'body', 'אם קיבלת את זה בטלפון – ההתראות עובדות.', 'url', '/account'));
  perform app.wake_notify();
end $$;
revoke all on function public.send_test_notification() from public, anon;
grant execute on function public.send_test_notification() to authenticated;
