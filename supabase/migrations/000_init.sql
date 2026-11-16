-- 000_init.sql
-- Shared helpers every later migration uses. Safe to run more than once.

-- Keeps updated_at honest on any table that has the column.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.touch_updated_at() from public, anon, authenticated;
