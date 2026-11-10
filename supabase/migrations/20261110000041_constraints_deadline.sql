-- The constraints deadline is the last day to submit, until 23:59 local time (it used to be stored
-- as the midnight that opens that day, so "22/10" closed as 22/10 began). It is edited on the
-- constraints screen until the cycle is published; moving a passed deadline forward reopens
-- collection (the automatic stage follows). The default distance of a new cycle is a setting.

insert into settings (key, value) values ('exemption_deadline_days', '40') on conflict (key) do nothing;

update cycles
set exemption_deadline = (((exemption_deadline at time zone app.tz())::date + time '23:59:59') at time zone app.tz())
where exemption_deadline is not null
  and (exemption_deadline at time zone app.tz())::time = time '00:00';
