-- 002_admin.sql
-- The base of the admin panel: who is an admin, the audit log, the site
-- settings the owner can change without code, and the one function that flips
-- a feature flag.
--
-- Every admin action is checked here, in the database. The pages under /admin
-- only show what these functions allow: calling one without being in the
-- admins table raises not_admin, whatever the UI did.
--
-- Make the first admin by hand in the SQL editor (there is no API for it on
-- purpose):
--   insert into public.admins (user_id, note)
--   select id, 'owner' from auth.users where email = 'you@example.com';
--
-- Run after 001_feature_flags.sql. Safe to run more than once.

-- Admins ------------------------------------------------------------------------

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text not null default '',
  added_at timestamptz not null default now()
);

alter table public.admins enable row level security;
-- No policies and no grants: the API roles cannot read or change this table.
revoke all on public.admins from anon, authenticated;

-- Is the person making this request an admin? Safe to call for anyone.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;

revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- The first line of every admin function: the caller's id, or an error.
create or replace function public.require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.admins a where a.user_id = me) then
    raise exception 'not_admin' using errcode = 'P0001';
  end if;
  return me;
end;
$$;

revoke execute on function public.require_admin() from public, anon, authenticated;

-- Audit log ---------------------------------------------------------------------

create table if not exists public.admin_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  -- Like 'flag.set', 'setting.set', 'video.remove', 'account.ban'.
  action text not null,
  target_type text not null default '',
  target_id text not null default '',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_log_created_idx on public.admin_log (created_at desc, id desc);

alter table public.admin_log enable row level security;
-- Read through admin_log_page() (009). Nothing writes it but admin_log_add().
revoke all on public.admin_log from anon, authenticated;

create or replace function public.admin_log_add(
  actor uuid,
  action text,
  target_type text,
  target_id text,
  details jsonb default '{}'::jsonb
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.admin_log (actor_id, action, target_type, target_id, details)
  values (actor, action, coalesce(target_type, ''), coalesce(target_id, ''), coalesce(details, '{}'::jsonb));
$$;

revoke execute on function public.admin_log_add(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- Site settings -----------------------------------------------------------------

-- One row per setting. "kind" says how the admin page draws it and how
-- set_site_setting() checks a new value:
--   number   a whole number between min_value and max_value
--   choice   one of the strings in options
--   boolean  true or false
--   text     up to max_value characters
create table if not exists public.site_settings (
  key text primary key,
  label text not null,
  description text not null default '',
  kind text not null check (kind in ('number', 'choice', 'boolean', 'text')),
  value jsonb not null,
  options jsonb not null default '[]'::jsonb,
  min_value int,
  max_value int,
  sort int not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

drop trigger if exists site_settings_touch on public.site_settings;
create trigger site_settings_touch
  before update on public.site_settings
  for each row execute function public.touch_updated_at();

alter table public.site_settings enable row level security;

-- The settings are not secret (limits, a banner text), so everyone may read
-- them: the upload form shows the limits and every page shows the banner.
drop policy if exists "site_settings are readable by everyone" on public.site_settings;
create policy "site_settings are readable by everyone"
  on public.site_settings
  for select
  to anon, authenticated
  using (true);

revoke all on public.site_settings from anon, authenticated;
grant select (key, label, description, kind, value, options, min_value, max_value, sort, updated_at)
  on public.site_settings to anon, authenticated;

insert into public.site_settings (key, label, description, kind, value, options, min_value, max_value, sort)
values
  ('upload_max_seconds', 'Longest clip', 'The longest a clip can be, in seconds. Longer uploads are refused.', 'number', '60', '[]', 3, 600, 10),
  ('upload_max_mb', 'Biggest file', 'The biggest file one upload can be, in megabytes.', 'number', '200', '[]', 1, 2048, 20),
  ('upload_daily_limit', 'Uploads per day', 'How many clips one account can upload in 24 hours.', 'number', '10', '[]', 1, 200, 30),
  ('upload_who', 'Who can upload', 'Everyone with an account, only verified accounts, or only accounts you invited.', 'choice', '"everyone"', '["everyone", "verified", "invite"]', null, null, 40),
  ('comments_enabled', 'Comments', 'Switch all commenting off without hiding the comments that are already there.', 'boolean', 'true', '[]', null, null, 50),
  ('signups_open', 'Sign-ups', 'When closed, nobody new can make an account. People who have one can still sign in.', 'boolean', 'true', '[]', null, null, 60),
  ('maintenance_banner', 'Banner text', 'A line shown at the top of every page, for example "Uploads are slow today". Leave it empty for no banner.', 'text', '""', '[]', null, 200, 70)
on conflict (key) do nothing;

-- A setting's value for the checks inside other functions.
create or replace function public.site_setting(setting_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select s.value from public.site_settings s where s.key = setting_key;
$$;

revoke execute on function public.site_setting(text) from public, anon, authenticated;

-- Changes one setting. Errors: not_signed_in, not_admin, not_found, bad_value.
create or replace function public.set_site_setting(p_key text, p_value jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_admin();
  s public.site_settings;
  n numeric;
begin
  select * into s from public.site_settings x where x.key = p_key for update;
  if s.key is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if p_value is null then
    raise exception 'bad_value' using errcode = 'P0001';
  end if;

  if s.kind = 'number' then
    if jsonb_typeof(p_value) <> 'number' then
      raise exception 'bad_value' using errcode = 'P0001';
    end if;
    n := (p_value #>> '{}')::numeric;
    if n <> trunc(n) or n < coalesce(s.min_value, n) or n > coalesce(s.max_value, n) then
      raise exception 'bad_value' using errcode = 'P0001';
    end if;
  elsif s.kind = 'choice' then
    if jsonb_typeof(p_value) <> 'string' or not (s.options @> jsonb_build_array(p_value)) then
      raise exception 'bad_value' using errcode = 'P0001';
    end if;
  elsif s.kind = 'boolean' then
    if jsonb_typeof(p_value) <> 'boolean' then
      raise exception 'bad_value' using errcode = 'P0001';
    end if;
  else
    if jsonb_typeof(p_value) <> 'string' or char_length(p_value #>> '{}') > coalesce(s.max_value, 200) then
      raise exception 'bad_value' using errcode = 'P0001';
    end if;
    -- One line of plain text: no line breaks or control characters.
    if (p_value #>> '{}') ~ '[[:cntrl:]]' then
      raise exception 'bad_value' using errcode = 'P0001';
    end if;
  end if;

  update public.site_settings x set value = p_value, updated_by = me where x.key = p_key;
  perform public.admin_log_add(me, 'setting.set', 'setting', p_key, jsonb_build_object('from', s.value, 'to', p_value));
  return jsonb_build_object('key', p_key, 'value', p_value);
end;
$$;

revoke execute on function public.set_site_setting(text, jsonb) from public, anon;
grant execute on function public.set_site_setting(text, jsonb) to authenticated;

-- Feature flags -------------------------------------------------------------------

-- Flips one flag. "test" keeps the listed ids and makes sure the admin who
-- pressed it is one of them. Errors: not_signed_in, not_admin, bad_mode,
-- not_found, locked (the admin flag cannot be switched off from the panel,
-- or the panel could never switch it back on).
create or replace function public.set_feature_flag(p_key text, p_mode text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_admin();
  old_mode text;
  row_users uuid[];
begin
  if p_mode is null or p_mode not in ('off', 'test', 'everyone') then
    raise exception 'bad_mode' using errcode = 'P0001';
  end if;

  select f.mode, f.users into old_mode, row_users
    from public.feature_flags f
   where f.key = p_key
     for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if p_key = 'admin' and p_mode = 'off' then
    raise exception 'locked' using errcode = 'P0001';
  end if;

  row_users := coalesce(row_users, '{}'::uuid[]);
  if p_mode = 'test' and not (me = any (row_users)) then
    row_users := row_users || me;
  end if;

  update public.feature_flags f
     set mode = p_mode, users = row_users, updated_by = me
   where f.key = p_key;

  perform public.admin_log_add(me, 'flag.set', 'flag', p_key, jsonb_build_object('from', old_mode, 'to', p_mode));
  return jsonb_build_object('key', p_key, 'mode', p_mode);
end;
$$;

revoke execute on function public.set_feature_flag(text, text) from public, anon;
grant execute on function public.set_feature_flag(text, text) to authenticated;
