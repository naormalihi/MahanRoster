-- "מסמך האפיון" is open to the gaf commanders too: everyone who reads (staff and commanders).
create or replace function public.spec_document() returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
begin
  if not app.can_read() then
    raise exception 'אין הרשאה' using errcode = '42501';
  end if;
  return (select jsonb_build_object('version', version, 'body', body, 'updated_at', updated_at)
            from app.spec_document where id = 1);
end $$;
revoke all on function public.spec_document() from public, anon;
grant execute on function public.spec_document() to authenticated;
