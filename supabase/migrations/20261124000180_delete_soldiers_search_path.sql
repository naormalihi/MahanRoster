-- delete_soldiers closes an employee's account with crypt()/gen_salt() (pgcrypto), which lives in
-- the "extensions" schema on Supabase – it was missing from the function's search path.
alter function public.delete_soldiers(uuid[]) set search_path = public, extensions, pg_temp;
