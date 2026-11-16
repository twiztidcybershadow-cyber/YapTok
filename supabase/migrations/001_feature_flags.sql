-- 001_feature_flags.sql
-- Feature flags. Every feature checks a row here, so the owner can switch it on
-- step by step from /admin without a deploy:
--   off       hidden for everyone
--   test      only for the user ids listed in "users"
--   everyone  on for all
--
-- Everyone may read the flags. Nobody can write them through the API: the
-- admin panel goes through set_feature_flag() in 002_admin.sql, which checks
-- the admins table and writes the audit log.
--
-- Run after 000_init.sql. Safe to run more than once.

create table if not exists public.feature_flags (
  key text primary key,
  label text not null default '',
  description text not null default '',
  mode text not null default 'off' check (mode in ('off', 'test', 'everyone')),
  users uuid[] not null default '{}',
  updated_at timestamptz not null default now(),
  -- Who flipped it last (null: never changed since the migration made it).
  updated_by uuid references auth.users (id) on delete set null
);

drop trigger if exists feature_flags_touch on public.feature_flags;
create trigger feature_flags_touch
  before update on public.feature_flags
  for each row execute function public.touch_updated_at();

alter table public.feature_flags enable row level security;

drop policy if exists "feature_flags are readable by everyone" on public.feature_flags;
create policy "feature_flags are readable by everyone"
  on public.feature_flags
  for select
  to anon, authenticated
  using (true);

revoke all on public.feature_flags from anon, authenticated;
-- updated_by is left out: who changed a flag is for admins (admin_flags() in 009).
grant select (key, label, description, mode, users, updated_at) on public.feature_flags to anon, authenticated;

-- Is this flag on for this person? For the checks inside other functions, so a
-- feature that is switched off is also off in the database, not only in the UI.
create or replace function public.flag_on(flag_key text, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.feature_flags f
    where f.key = flag_key
      and (f.mode = 'everyone' or (f.mode = 'test' and uid is not null and uid = any (f.users)))
  );
$$;

revoke execute on function public.flag_on(text, uuid) from public, anon, authenticated;

-- The flags of this first session. Later migrations add their own.
insert into public.feature_flags (key, label, description, mode)
values
  ('accounts', 'Accounts', 'Sign up, sign in, the account menu and settings. The base for everything else.', 'everyone'),
  ('admin', 'Admin panel', 'The /admin panel for accounts in the admins table: flags, site settings, moderation, log and stats.', 'everyone')
on conflict (key) do nothing;
