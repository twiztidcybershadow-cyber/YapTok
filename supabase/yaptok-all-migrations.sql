-- YapTok: every migration in supabase/migrations, in order (18 files).

-- ===== 000_init.sql =====
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

-- ===== 001_feature_flags.sql =====
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

-- ===== 002_admin.sql =====
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

-- ===== 003_profiles.sql =====
-- 003_profiles.sql
-- Accounts: one public profile per auth user. On YapTok the profile is also
-- the creator page (/@username), so it carries the counts shown there.
--
-- - A trigger creates the profile (with a generated username) when someone
--   signs up. It refuses while the signups_open setting is off.
-- - complete_signup(username, birthdate) confirms the username and records the
--   birthdate. People under 13 are refused.
-- - Everyone can read profiles, but birthdate and the ban columns are not
--   readable through the API.
-- - Owners update their own row (username, display name, avatar, bio only).
-- - verified and invited are set by admins (008_moderation.sql) and decide who
--   may upload when the upload_who setting is not "everyone".
-- - Rows are never deleted directly: delete_account() removes the auth user
--   and the profile goes with it.
--
-- Run after 002_admin.sql. Safe to run more than once.

-- Username rules, shared by the table, the trigger and the RPCs.
-- Keep in step with lib/accounts/validation.ts.
create or replace function public.username_is_valid(name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select name is not null
    and name ~ '^[a-z0-9_]{3,24}$'
    and name not in (
      'admin', 'administrator', 'api', 'auth', 'discover', 'feed', 'following', 'foryou',
      'help', 'inbox', 'login', 'logout', 'me', 'moderator', 'null', 'root', 'search',
      'settings', 'signup', 'sounds', 'staff', 'support', 'system', 'tag', 'undefined',
      'upload', 'welcome', 'yapin', 'yaptok'
    );
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  display_name text not null default '',
  avatar_url text,
  bio text not null default '',
  birthdate date,
  onboarded boolean not null default false,
  verified boolean not null default false,
  invited boolean not null default false,
  follower_count int not null default 0,
  following_count int not null default 0,
  video_count int not null default 0,
  like_count int not null default 0,
  banned_at timestamptz,
  banned_reason text,
  banned_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint profiles_username_valid check (public.username_is_valid(username)),
  constraint profiles_display_name_length check (char_length(display_name) <= 50),
  constraint profiles_bio_length check (char_length(bio) <= 300),
  constraint profiles_avatar_url_https check (avatar_url is null or avatar_url ~ '^https://')
);

-- Usernames are unique without caring about case.
create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username));
create index if not exists profiles_created_idx on public.profiles (created_at desc);

-- Row level security ---------------------------------------------------------

alter table public.profiles enable row level security;

drop policy if exists "profiles are readable by everyone" on public.profiles;
create policy "profiles are readable by everyone"
  on public.profiles
  for select
  to anon, authenticated
  using (true);

drop policy if exists "people update their own profile" on public.profiles;
create policy "people update their own profile"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- No insert or delete policies: the trigger inserts, delete_account() deletes.

-- Column privileges: birthdate and the ban columns are never readable through
-- the API, and the counts, verified and invited are never writable.
revoke all on public.profiles from anon, authenticated;
grant select (id, username, display_name, avatar_url, bio, onboarded, verified,
              follower_count, following_count, video_count, like_count, created_at)
  on public.profiles to anon, authenticated;
grant update (username, display_name, avatar_url, bio)
  on public.profiles to authenticated;

-- Helpers --------------------------------------------------------------------

-- Is this account banned? Every function that writes something asks this.
create or replace function public.is_banned(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = uid and p.banned_at is not null);
$$;

-- Callable by everyone: row level security policies (the feed, comments) run
-- it as the person reading.
revoke execute on function public.is_banned(uuid) from public;
grant execute on function public.is_banned(uuid) to anon, authenticated;

-- Turns an email or a name into a free username like "antic_4821".
create or replace function public.generate_username(seed text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  base text;
  candidate text;
  tries int := 0;
begin
  base := left(regexp_replace(lower(coalesce(seed, '')), '[^a-z0-9_]', '', 'g'), 16);
  if char_length(base) < 3 then
    base := 'user';
  end if;
  loop
    candidate := base || '_' || lpad(floor(random() * 10000)::int::text, 4, '0');
    exit when public.username_is_valid(candidate)
      and not exists (select 1 from public.profiles p where lower(p.username) = candidate);
    tries := tries + 1;
    if tries > 25 then
      candidate := 'user_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
      exit;
    end if;
  end loop;
  return candidate;
end;
$$;

-- Is this username free for the person asking? Used by the signup and settings forms.
create or replace function public.username_available(name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.username_is_valid(name)
    and not exists (
      select 1 from public.profiles p
      where lower(p.username) = lower(name)
        and p.id is distinct from (select auth.uid())
    );
$$;

revoke execute on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- Age in whole years on a given day.
create or replace function public.age_on(birthdate date, today date default current_date)
returns int
language sql
immutable
set search_path = ''
as $$
  select extract(year from age(today, birthdate))::int;
$$;

-- New user trigger -------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  wanted text := lower(meta ->> 'username');
  claimed_birthdate text := meta ->> 'birthdate';
  chosen text;
  shown text;
  picture text := meta ->> 'avatar_url';
begin
  -- The owner closed sign-ups in /admin/settings: no new accounts at all.
  if coalesce(public.site_setting('signups_open'), 'true'::jsonb) = 'false'::jsonb then
    raise exception 'signups_closed' using errcode = 'P0001';
  end if;

  -- Email sign up sends the birthdate along. Refuse under 13 right away so no
  -- account is created. (Other sign ups confirm it in complete_signup.)
  if claimed_birthdate ~ '^\d{4}-\d{2}-\d{2}$' then
    if public.age_on(claimed_birthdate::date) < 13 then
      raise exception 'too_young' using errcode = 'P0001';
    end if;
  end if;

  if public.username_is_valid(wanted)
     and not exists (select 1 from public.profiles p where lower(p.username) = wanted) then
    chosen := wanted;
  else
    chosen := public.generate_username(
      coalesce(nullif(meta ->> 'full_name', ''), split_part(coalesce(new.email, ''), '@', 1))
    );
  end if;

  shown := left(coalesce(nullif(meta ->> 'full_name', ''), nullif(meta ->> 'name', ''), chosen), 50);

  insert into public.profiles (id, username, display_name, avatar_url)
  values (
    new.id,
    chosen,
    shown,
    case when picture ~ '^https://' then picture else null end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RPCs -------------------------------------------------------------------------

-- Finishes sign up: confirms the username and records the birthdate (13+ only).
-- Errors (the message is the code the app shows a friendly text for):
--   not_signed_in, invalid_username, username_taken, birthdate_required,
--   invalid_birthdate, too_young, already_complete
create or replace function public.complete_signup(username text, birthdate date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  wanted text := lower(trim(complete_signup.username));
  current_profile public.profiles;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;

  select * into current_profile from public.profiles p where p.id = me;
  if current_profile.onboarded then
    raise exception 'already_complete' using errcode = 'P0001';
  end if;

  if complete_signup.birthdate is null then
    raise exception 'birthdate_required' using errcode = 'P0001';
  end if;
  if complete_signup.birthdate > current_date or complete_signup.birthdate < date '1900-01-01' then
    raise exception 'invalid_birthdate' using errcode = 'P0001';
  end if;
  if public.age_on(complete_signup.birthdate) < 13 then
    raise exception 'too_young' using errcode = 'P0001';
  end if;

  if not public.username_is_valid(wanted) then
    raise exception 'invalid_username' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles p where lower(p.username) = wanted and p.id <> me) then
    raise exception 'username_taken' using errcode = 'P0001';
  end if;

  if current_profile.id is null then
    -- The trigger did not run (for example a user created before this migration).
    insert into public.profiles (id, username, display_name, birthdate, onboarded)
    values (me, wanted, wanted, complete_signup.birthdate, true);
  else
    update public.profiles p
       set username = wanted,
           birthdate = complete_signup.birthdate,
           onboarded = true
     where p.id = me;
  end if;
end;
$$;

revoke execute on function public.complete_signup(text, date) from public, anon;
grant execute on function public.complete_signup(text, date) to authenticated;

-- Deletes the signed in person's account. The profile row and everything that
-- hangs off it go with it (on delete cascade).
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  delete from auth.users u where u.id = me;
end;
$$;

revoke execute on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;

-- What proxy.ts asks once per page: is this account banned, is it an admin?
create or replace function public.session_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'banned', public.is_banned((select auth.uid())),
    'admin', public.is_admin()
  );
$$;

revoke execute on function public.session_status() from public;
grant execute on function public.session_status() to anon, authenticated;

-- Internal helpers are not part of the API.
revoke execute on function public.generate_username(text) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.age_on(date, date) from public, anon, authenticated;
-- username_is_valid stays callable: the check constraint on profiles runs it
-- as the person updating their own row.

-- ===== 004_videos.sql =====
-- 004_videos.sql
-- Clips. The browser uploads the file straight to Cloudflare R2 in parts; the
-- database only ever sees the row, never the bytes.
--
-- The life of a clip:
--   uploading   create_upload() made the row and the app handed out part URLs
--   uploaded    every part is in R2 (finish_upload); 005 queues the encode job
--   processing  the encoder worker has claimed it
--   ready       HLS, cover and preview are in R2: it can be in the feed
--   failed      the upload was cancelled or the encode gave up (see "error")
--
-- A clip is in the feed when it is public, ready and not removed by an admin,
-- and its owner is not banned. Row level security says exactly that, so no
-- page can show a clip it should not.
--
-- The limits (length, size, per day, who may upload) are rows in
-- site_settings (002), read here at upload time: changing one in
-- /admin/settings takes effect on the next upload.
--
-- Run after 003_profiles.sql. Safe to run more than once.

-- Accepted video types and the extension each is stored with.
-- Keep in step with lib/upload/rules.ts.
create or replace function public.video_extension_for(mime text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case mime
    when 'video/mp4' then 'mp4'
    when 'video/quicktime' then 'mov'
    when 'video/webm' then 'webm'
    when 'video/x-matroska' then 'mkv'
    else null
  end;
$$;

-- Hashtags as typed ("#Cats", "cats ", "CATS") to a clean list: lower case,
-- letters, digits and underscores, 1 to 30 characters, no repeats, at most 8.
-- Keep in step with lib/upload/rules.ts.
create or replace function public.clean_hashtags(tags text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(t order by first_at), '{}'::text[])
  from (
    select t, min(n) as first_at
    from (
      select lower(regexp_replace(raw, '^#+', '')) as t, n
      from unnest(coalesce(tags, '{}'::text[])) with ordinality as u(raw, n)
    ) x
    where t ~ '^[a-z0-9_]{1,30}$'
    group by t
    order by first_at
    limit 8
  ) y;
$$;

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  caption text not null default '',
  hashtags text[] not null default '{}',
  visibility text not null default 'public',
  status text not null default 'uploading',
  source_key text,
  source_bytes bigint,
  source_mime text,
  -- Where the creator put the cover frame, in seconds. The encoder makes the
  -- cover image there. Null: the encoder picks.
  cover_at numeric,
  duration_s numeric,
  width int,
  height int,
  thumbnail_url text,
  hls_key text,
  renditions jsonb,
  preview_sprite_key text,
  error text,
  like_count int not null default 0,
  comment_count int not null default 0,
  view_count bigint not null default 0,
  share_count int not null default 0,
  -- Set by an admin (008_moderation.sql). A removed clip is hidden from
  -- everyone but its owner and admins, and can be restored.
  removed_at timestamptz,
  removed_by uuid references auth.users (id) on delete set null,
  removed_reason text,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint videos_caption_length check (char_length(caption) <= 300),
  constraint videos_hashtags_count check (cardinality(hashtags) <= 8),
  constraint videos_visibility_valid check (visibility in ('public', 'private')),
  constraint videos_status_valid check (status in ('uploading', 'uploaded', 'processing', 'ready', 'failed')),
  constraint videos_source_bytes_range check (source_bytes is null or source_bytes between 1 and 2147483648),
  constraint videos_source_mime_valid check (source_mime is null or public.video_extension_for(source_mime) is not null),
  constraint videos_cover_at_range check (cover_at is null or cover_at between 0 and 3600),
  constraint videos_renditions_array check (renditions is null or jsonb_typeof(renditions) = 'array'),
  constraint videos_thumbnail_url_http check (thumbnail_url is null or thumbnail_url ~ '^https?://')
);

create index if not exists videos_owner_created_idx on public.videos (owner_id, created_at desc);
create index if not exists videos_feed_idx on public.videos (published_at desc, id desc)
  where visibility = 'public' and status = 'ready' and removed_at is null;
create index if not exists videos_hashtags_idx on public.videos using gin (hashtags);
create index if not exists videos_created_idx on public.videos (created_at desc);

-- updated_at moves when the clip itself changes, not for a view, a like or a share.
create or replace function public.touch_video_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.caption, new.hashtags, new.visibility, new.status, new.removed_at)
     is distinct from (old.caption, old.hashtags, old.visibility, old.status, old.removed_at) then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists videos_touch on public.videos;
create trigger videos_touch
  before update on public.videos
  for each row execute function public.touch_video_updated_at();

-- published_at is set once, the first moment a clip is public and ready.
create or replace function public.videos_set_published_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.visibility = 'public' and new.status = 'ready' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists videos_published_at on public.videos;
create trigger videos_published_at
  before insert or update of status, visibility on public.videos
  for each row execute function public.videos_set_published_at();

-- profiles.video_count: the clips a visitor can see on the profile.
create or replace function public.videos_count_public()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  was_counted boolean := tg_op <> 'INSERT'
    and old.visibility = 'public' and old.status = 'ready' and old.removed_at is null;
  is_counted boolean := tg_op <> 'DELETE'
    and new.visibility = 'public' and new.status = 'ready' and new.removed_at is null;
begin
  if was_counted and not is_counted then
    update public.profiles p set video_count = greatest(p.video_count - 1, 0) where p.id = old.owner_id;
  elsif is_counted and not was_counted then
    update public.profiles p set video_count = p.video_count + 1 where p.id = new.owner_id;
  end if;
  return null;
end;
$$;

drop trigger if exists videos_count_public on public.videos;
create trigger videos_count_public
  after insert or update of status, visibility, removed_at or delete on public.videos
  for each row execute function public.videos_count_public();

-- Row level security ---------------------------------------------------------

alter table public.videos enable row level security;

drop policy if exists "clips in the feed are readable by everyone" on public.videos;
create policy "clips in the feed are readable by everyone"
  on public.videos
  for select
  to anon, authenticated
  using (
    visibility = 'public' and status = 'ready' and removed_at is null
    and not public.is_banned(owner_id)
  );

drop policy if exists "owners read their own clips" on public.videos;
create policy "owners read their own clips"
  on public.videos
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "admins read every clip" on public.videos;
create policy "admins read every clip"
  on public.videos
  for select
  to authenticated
  using ((select public.is_admin()));

-- No insert, update or delete policies: everything goes through the functions.
revoke all on public.videos from anon, authenticated;
grant select on public.videos to anon, authenticated;

-- RPCs -------------------------------------------------------------------------

-- Starts an upload: checks every rule, makes the row and says where in R2 the
-- file goes. duration_s is what the browser measured; the encoder measures
-- again and refuses a clip that is really longer (005).
-- Errors: not_signed_in, upload_off, banned, not_onboarded, not_allowed,
--   caption_too_long, bad_visibility, file_empty, file_too_big, bad_type,
--   too_long, daily_limit
create or replace function public.create_upload(
  caption text,
  hashtags text[],
  bytes bigint,
  mime text,
  duration_s numeric default null,
  cover_at numeric default null,
  visibility text default 'public'
)
returns table (video_id uuid, source_key text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  me_profile public.profiles;
  clean_caption text := trim(both from coalesce(create_upload.caption, ''));
  ext text := public.video_extension_for(create_upload.mime);
  who text := coalesce(public.site_setting('upload_who') #>> '{}', 'everyone');
  max_mb bigint := coalesce((public.site_setting('upload_max_mb') #>> '{}')::bigint, 200);
  max_s numeric := coalesce((public.site_setting('upload_max_seconds') #>> '{}')::numeric, 60);
  per_day int := coalesce((public.site_setting('upload_daily_limit') #>> '{}')::int, 10);
  recent int;
  new_id uuid := gen_random_uuid();
  new_key text;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not public.flag_on('upload', me) then
    raise exception 'upload_off' using errcode = 'P0001';
  end if;

  select * into me_profile from public.profiles p where p.id = me;
  if me_profile.banned_at is not null then
    raise exception 'banned' using errcode = 'P0001';
  end if;
  if me_profile.id is null or not me_profile.onboarded or me_profile.birthdate is null then
    raise exception 'not_onboarded' using errcode = 'P0001';
  end if;
  if (who = 'verified' and not me_profile.verified)
     or (who = 'invite' and not me_profile.invited) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;

  if char_length(clean_caption) > 300 then
    raise exception 'caption_too_long' using errcode = 'P0001';
  end if;
  if coalesce(create_upload.visibility, 'public') not in ('public', 'private') then
    raise exception 'bad_visibility' using errcode = 'P0001';
  end if;
  if create_upload.bytes is null or create_upload.bytes < 1 then
    raise exception 'file_empty' using errcode = 'P0001';
  end if;
  if create_upload.bytes > max_mb * 1024 * 1024 then
    raise exception 'file_too_big' using errcode = 'P0001';
  end if;
  if ext is null then
    raise exception 'bad_type' using errcode = 'P0001';
  end if;
  -- One second of slack: browsers round durations differently.
  if create_upload.duration_s is not null and create_upload.duration_s > max_s + 1 then
    raise exception 'too_long' using errcode = 'P0001';
  end if;

  -- One upload at a time per person, so two requests cannot both pass the count.
  perform pg_advisory_xact_lock(hashtextextended('create_upload:' || me::text, 0));
  select count(*) into recent
    from public.videos v
   where v.owner_id = me
     and v.created_at > now() - interval '24 hours';
  if recent >= per_day then
    raise exception 'daily_limit' using errcode = 'P0001';
  end if;

  new_key := 'uploads/' || me::text || '/' || new_id::text || '/source.' || ext;
  insert into public.videos (id, owner_id, caption, hashtags, visibility, source_key, source_bytes, source_mime, cover_at)
  values (
    new_id, me, clean_caption, public.clean_hashtags(create_upload.hashtags),
    coalesce(create_upload.visibility, 'public'), new_key,
    create_upload.bytes, create_upload.mime,
    case when create_upload.cover_at between 0 and 3600 then create_upload.cover_at else null end
  );
  return query select new_id, new_key;
end;
$$;

-- Every part is in R2: mark the clip uploaded. Calling it twice is fine.
create or replace function public.finish_upload(video_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  current_status text;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  select v.status into current_status
    from public.videos v
   where v.id = finish_upload.video_id and v.owner_id = me
   for update;
  if current_status is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if current_status = 'uploaded' then
    return 'uploaded';
  end if;
  if current_status <> 'uploading' then
    raise exception 'not_uploading' using errcode = 'P0001';
  end if;
  update public.videos v
     set status = 'uploaded', error = null
   where v.id = finish_upload.video_id;
  return 'uploaded';
end;
$$;

-- The upload was cancelled or broke: mark the clip failed.
create or replace function public.abandon_upload(video_id uuid, reason text default 'cancelled')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  current_status text;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  select v.status into current_status
    from public.videos v
   where v.id = abandon_upload.video_id and v.owner_id = me
   for update;
  if current_status is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if current_status = 'failed' then
    return 'failed';
  end if;
  if current_status <> 'uploading' then
    raise exception 'not_uploading' using errcode = 'P0001';
  end if;
  update public.videos v
     set status = 'failed', error = left(coalesce(nullif(trim(both from reason), ''), 'cancelled'), 200)
   where v.id = abandon_upload.video_id;
  return 'failed';
end;
$$;

-- The owner changes the caption, the hashtags or who can see the clip.
-- Errors: not_signed_in, banned, caption_too_long, bad_visibility, not_found
create or replace function public.update_video_details(
  video_id uuid,
  caption text,
  hashtags text[],
  visibility text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  clean_caption text := trim(both from coalesce(update_video_details.caption, ''));
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if public.is_banned(me) then
    raise exception 'banned' using errcode = 'P0001';
  end if;
  if char_length(clean_caption) > 300 then
    raise exception 'caption_too_long' using errcode = 'P0001';
  end if;
  if update_video_details.visibility is null or update_video_details.visibility not in ('public', 'private') then
    raise exception 'bad_visibility' using errcode = 'P0001';
  end if;
  update public.videos v
     set caption = clean_caption,
         hashtags = public.clean_hashtags(update_video_details.hashtags),
         visibility = update_video_details.visibility
   where v.id = update_video_details.video_id and v.owner_id = me;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.create_upload(text, text[], bigint, text, numeric, numeric, text) from public, anon;
revoke execute on function public.finish_upload(uuid) from public, anon;
revoke execute on function public.abandon_upload(uuid, text) from public, anon;
revoke execute on function public.update_video_details(uuid, text, text[], text) from public, anon;
grant execute on function public.create_upload(text, text[], bigint, text, numeric, numeric, text) to authenticated;
grant execute on function public.finish_upload(uuid) to authenticated;
grant execute on function public.abandon_upload(uuid, text) to authenticated;
grant execute on function public.update_video_details(uuid, text, text[], text) to authenticated;

revoke execute on function public.touch_video_updated_at() from public, anon, authenticated;
revoke execute on function public.videos_count_public() from public, anon, authenticated;
revoke execute on function public.videos_set_published_at() from public, anon, authenticated;

insert into public.feature_flags (key, label, description, mode)
values
  ('upload', 'Upload', 'The /upload page: pick a clip, add a caption, hashtags and a cover frame. Files go straight to R2.', 'off'),
  ('record', 'Record in the browser', 'A Record button on the upload page that films a clip with the phone or laptop camera. Needs the Upload flag.', 'off')
on conflict (key) do nothing;

-- ===== 005_processing.sql =====
-- 005_processing.sql
-- The encode queue. A worker on its own box (worker/, ops/encoder/) turns
-- every uploaded clip into HLS, a cover image and a preview sprite.
--
-- - encode_jobs has one row per clip. A trigger queues the job the moment a
--   clip becomes 'uploaded'.
-- - The worker talks to the database only through four functions, with the
--   service role key: claim_encode_job, encode_progress, encode_done and
--   encode_failed. Nobody else can call them.
-- - A job is tried up to 3 times. A job that has been running for more than
--   2 hours 15 minutes is taken back.
-- - encode_done refuses a clip that is really longer than the
--   upload_max_seconds setting, whatever the browser said at upload time.
-- - storage_cleanup lists R2 folders to empty after a clip is deleted. The
--   worker drains it between jobs (claim_cleanup, cleanup_done, cleanup_failed).
--
-- Run after 004_videos.sql. Safe to run more than once.

create or replace function public.encode_max_attempts()
returns int
language sql
immutable
set search_path = ''
as $$ select 3 $$;

create or replace function public.encode_stale_after()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '2 hours 15 minutes' $$;

create table if not exists public.encode_jobs (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null unique references public.videos (id) on delete cascade,
  status text not null default 'queued',
  attempts int not null default 0,
  worker text,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  progress int not null default 0,
  created_at timestamptz not null default now(),
  constraint encode_jobs_status_valid check (status in ('queued', 'running', 'done', 'failed')),
  constraint encode_jobs_progress_range check (progress between 0 and 100),
  constraint encode_jobs_attempts_range check (attempts >= 0)
);

create index if not exists encode_jobs_queued_idx on public.encode_jobs (created_at)
  where status = 'queued';
create index if not exists encode_jobs_running_idx on public.encode_jobs (worker)
  where status = 'running';

alter table public.encode_jobs enable row level security;

drop policy if exists "owners read the jobs of their own clips" on public.encode_jobs;
create policy "owners read the jobs of their own clips"
  on public.encode_jobs
  for select
  to authenticated
  using (
    exists (
      select 1 from public.videos v
      where v.id = encode_jobs.video_id and v.owner_id = (select auth.uid())
    )
  );

revoke all on public.encode_jobs from anon, authenticated;
grant select on public.encode_jobs to authenticated;

-- Queue a job when a clip becomes 'uploaded'.
create or replace function public.queue_encode_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'uploaded' and (tg_op = 'INSERT' or old.status is distinct from 'uploaded') then
    insert into public.encode_jobs (video_id)
    values (new.id)
    on conflict (video_id) do update
      set status = 'queued',
          attempts = 0,
          progress = 0,
          worker = null,
          error = null,
          started_at = null,
          finished_at = null
      where public.encode_jobs.status in ('done', 'failed');
  end if;
  return new;
end;
$$;

drop trigger if exists videos_queue_encode on public.videos;
create trigger videos_queue_encode
  after insert or update of status on public.videos
  for each row execute function public.queue_encode_job();

-- Clips uploaded before this migration ran.
insert into public.encode_jobs (video_id)
select v.id from public.videos v where v.status = 'uploaded'
on conflict (video_id) do nothing;

-- One attempt is over without success: queue it again, or fail the clip.
create or replace function public.encode_give_up_attempt(job public.encode_jobs, reason text, retry boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_reason text := left(coalesce(nullif(trim(both from reason), ''), 'encode failed'), 200);
begin
  if retry and job.attempts < public.encode_max_attempts() then
    update public.encode_jobs j
       set status = 'queued', progress = 0, worker = null, error = clean_reason, finished_at = null
     where j.id = job.id;
    return 'queued';
  end if;
  update public.encode_jobs j
     set status = 'failed', error = clean_reason, finished_at = now()
   where j.id = job.id;
  update public.videos v
     set status = 'failed', error = clean_reason
   where v.id = job.video_id;
  return 'failed';
end;
$$;

-- The next job for this worker, oldest first. Also takes back jobs this
-- worker left running (it restarted) and jobs that have run for too long.
-- Nothing is handed out while the processing flag is off for the owner.
create or replace function public.claim_encode_job(worker text)
returns table (
  job_id uuid,
  video_id uuid,
  owner_id uuid,
  source_key text,
  source_bytes bigint,
  source_mime text,
  attempt int,
  cover_at numeric,
  max_seconds numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  me text := left(coalesce(nullif(trim(both from claim_encode_job.worker), ''), 'worker'), 100);
  dead public.encode_jobs;
  next_job public.encode_jobs;
  vid public.videos;
begin
  for dead in
    select * from public.encode_jobs j
     where j.status = 'running'
       and (j.worker = me or j.started_at < now() - public.encode_stale_after())
     for update skip locked
  loop
    perform public.encode_give_up_attempt(dead, 'the worker stopped during the encode', true);
  end loop;

  select j.* into next_job
    from public.encode_jobs j
    join public.videos v on v.id = j.video_id
   where j.status = 'queued'
     and v.status in ('uploaded', 'processing')
     and v.source_key is not null
     and public.flag_on('processing', v.owner_id)
   order by j.created_at
   limit 1
   for update of j skip locked;
  if next_job.id is null then
    return;
  end if;

  update public.encode_jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         worker = me,
         started_at = now(),
         finished_at = null,
         progress = 0
   where j.id = next_job.id
  returning * into next_job;

  update public.videos v
     set status = 'processing', error = null
   where v.id = next_job.video_id
  returning * into vid;

  return query select next_job.id, vid.id, vid.owner_id, vid.source_key, vid.source_bytes, vid.source_mime,
                      next_job.attempts, vid.cover_at,
                      coalesce((public.site_setting('upload_max_seconds') #>> '{}')::numeric, 60);
end;
$$;

-- False when the job is not running any more (taken back as stale).
create or replace function public.encode_progress(job_id uuid, pct int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.encode_jobs j
     set progress = greatest(0, least(100, coalesce(encode_progress.pct, 0)))
   where j.id = encode_progress.job_id and j.status = 'running';
  return found;
end;
$$;

-- The encode worked: save what the worker made and publish the clip.
-- Errors: not_found, not_running, bad_renditions
create or replace function public.encode_done(
  job_id uuid,
  duration_s numeric,
  width int,
  height int,
  hls_key text,
  thumbnail_url text,
  preview_sprite_key text,
  renditions jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.encode_jobs;
  max_s numeric := coalesce((public.site_setting('upload_max_seconds') #>> '{}')::numeric, 60);
begin
  select * into job from public.encode_jobs j where j.id = encode_done.job_id for update;
  if job.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if job.status = 'done' then
    return 'done';
  end if;
  if job.status <> 'running' then
    raise exception 'not_running' using errcode = 'P0001';
  end if;
  if encode_done.renditions is null or jsonb_typeof(encode_done.renditions) <> 'array'
     or jsonb_array_length(encode_done.renditions) = 0 then
    raise exception 'bad_renditions' using errcode = 'P0001';
  end if;

  -- The real length decides, not what the browser said at upload time.
  if encode_done.duration_s is not null and encode_done.duration_s > max_s + 1 then
    return public.encode_give_up_attempt(
      job, 'this clip is longer than ' || max_s::text || ' seconds, the longest a clip can be', false);
  end if;

  update public.encode_jobs j
     set status = 'done', progress = 100, error = null, finished_at = now()
   where j.id = job.id;

  update public.videos v
     set status = 'ready',
         duration_s = encode_done.duration_s,
         width = encode_done.width,
         height = encode_done.height,
         hls_key = encode_done.hls_key,
         thumbnail_url = nullif(encode_done.thumbnail_url, ''),
         preview_sprite_key = encode_done.preview_sprite_key,
         renditions = encode_done.renditions,
         error = null
   where v.id = job.video_id;
  return 'done';
end;
$$;

-- 'queued' when it will be tried again, 'failed' when the clip is failed.
create or replace function public.encode_failed(job_id uuid, error text, retry boolean default true)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.encode_jobs;
begin
  select * into job from public.encode_jobs j where j.id = encode_failed.job_id for update;
  if job.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if job.status = 'failed' then
    return 'failed';
  end if;
  if job.status <> 'running' then
    raise exception 'not_running' using errcode = 'P0001';
  end if;
  return public.encode_give_up_attempt(job, encode_failed.error, coalesce(encode_failed.retry, true));
end;
$$;

-- Storage cleanup -----------------------------------------------------------------

-- R2 folders to delete. No foreign key: the clip row is gone by then.
create table if not exists public.storage_cleanup (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null,
  prefix text not null,
  status text not null default 'queued',
  attempts int not null default 0,
  worker text,
  error text,
  deleted_objects int,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint storage_cleanup_status_valid check (status in ('queued', 'running', 'done', 'failed')),
  -- Only the two folders a clip has, so a bad row can never empty the bucket.
  constraint storage_cleanup_prefix_valid check (
    prefix ~ '^hls/[0-9a-f-]{36}/$' or prefix ~ '^uploads/[0-9a-f-]{36}/[0-9a-f-]{36}/$'
  ),
  constraint storage_cleanup_once unique (prefix)
);

create index if not exists storage_cleanup_todo_idx on public.storage_cleanup (queued_at)
  where status in ('queued', 'failed', 'running');

alter table public.storage_cleanup enable row level security;
revoke all on public.storage_cleanup from anon, authenticated;

-- Whenever a clip row goes (the owner deleted it, or the account was
-- deleted), queue its two folders.
create or replace function public.videos_queue_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.storage_cleanup (video_id, prefix)
  values
    (old.id, 'hls/' || old.id::text || '/'),
    (old.id, 'uploads/' || old.owner_id::text || '/' || old.id::text || '/')
  on conflict on constraint storage_cleanup_once do update
    set status = 'queued', attempts = 0, error = null, queued_at = now();
  return old;
end;
$$;

drop trigger if exists videos_queue_cleanup on public.videos;
create trigger videos_queue_cleanup
  after delete on public.videos
  for each row execute function public.videos_queue_cleanup();

-- The owner deletes one of their clips for good. Errors: not_signed_in, not_found
create or replace function public.delete_video(video_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  delete from public.videos v where v.id = delete_video.video_id and v.owner_id = me;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end;
$$;

-- The next folders for the worker. Queued and failed rows (under 5 tries),
-- and running rows left behind for 15 minutes.
create or replace function public.claim_cleanup(worker text, lim int default 20)
returns table (id uuid, prefix text, attempt int)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
  with picked as (
    select c.id
    from public.storage_cleanup c
    where (c.status in ('queued', 'failed') and c.attempts < 5)
       or (c.status = 'running' and c.started_at < now() - interval '15 minutes')
    order by c.queued_at, c.id
    limit least(greatest(coalesce(claim_cleanup.lim, 20), 1), 100)
    for update skip locked
  )
  update public.storage_cleanup c
     set status = 'running', attempts = c.attempts + 1, worker = left(claim_cleanup.worker, 100),
         started_at = now(), error = null
    from picked p
   where c.id = p.id
  returning c.id, c.prefix, c.attempts;
end;
$$;

create or replace function public.cleanup_done(cleanup_id uuid, deleted int default null)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.storage_cleanup c
     set status = 'done', finished_at = now(), error = null, deleted_objects = cleanup_done.deleted
   where c.id = cleanup_done.cleanup_id;
$$;

create or replace function public.cleanup_failed(cleanup_id uuid, error text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.storage_cleanup c
     set status = 'failed', finished_at = now(), error = left(coalesce(cleanup_failed.error, ''), 500)
   where c.id = cleanup_failed.cleanup_id;
$$;

-- Who may call what ----------------------------------------------------------------

revoke execute on function public.claim_encode_job(text) from public, anon, authenticated;
revoke execute on function public.encode_progress(uuid, int) from public, anon, authenticated;
revoke execute on function public.encode_done(uuid, numeric, int, int, text, text, text, jsonb)
  from public, anon, authenticated;
revoke execute on function public.encode_failed(uuid, text, boolean) from public, anon, authenticated;
revoke execute on function public.encode_give_up_attempt(public.encode_jobs, text, boolean)
  from public, anon, authenticated;
revoke execute on function public.queue_encode_job() from public, anon, authenticated;
revoke execute on function public.videos_queue_cleanup() from public, anon, authenticated;
revoke execute on function public.claim_cleanup(text, int) from public, anon, authenticated;
revoke execute on function public.cleanup_done(uuid, int) from public, anon, authenticated;
revoke execute on function public.cleanup_failed(uuid, text) from public, anon, authenticated;
revoke execute on function public.delete_video(uuid) from public, anon;

grant execute on function public.claim_encode_job(text) to service_role;
grant execute on function public.encode_progress(uuid, int) to service_role;
grant execute on function public.encode_done(uuid, numeric, int, int, text, text, text, jsonb) to service_role;
grant execute on function public.encode_failed(uuid, text, boolean) to service_role;
grant execute on function public.claim_cleanup(text, int) to service_role;
grant execute on function public.cleanup_done(uuid, int) to service_role;
grant execute on function public.cleanup_failed(uuid, text) to service_role;
grant execute on function public.delete_video(uuid) to authenticated;

insert into public.feature_flags (key, label, description, mode)
values
  ('processing', 'Processing', 'The encoder worker turns uploads into HLS, a cover and a preview sprite. While it is off, uploads wait in the queue.', 'off')
on conflict (key) do nothing;

-- ===== 006_social.sql =====
-- 006_social.sql
-- Likes, follows and comments.
--
-- - Nothing is written with a plain insert or delete: toggle_like,
--   toggle_follow, add_comment and delete_comment check the flag, the ban and
--   the rules, and keep the counts on videos and profiles right.
-- - Likes are private (you can read your own). Follows are public.
-- - Comments are readable on any clip that is readable, unless removed.
-- - add_comment also checks the comments_enabled site setting, so the owner
--   can stop all commenting from /admin/settings in one click.
--
-- Run after 005_processing.sql. Safe to run more than once.

-- Can the person asking see this clip? Same rule as the feed policy in 004.
create or replace function public.video_is_visible(vid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.videos v
    where v.id = vid
      and (
        (v.visibility = 'public' and v.status = 'ready' and v.removed_at is null
          and not public.is_banned(v.owner_id))
        or v.owner_id = (select auth.uid())
      )
  );
$$;

revoke execute on function public.video_is_visible(uuid) from public;
grant execute on function public.video_is_visible(uuid) to anon, authenticated;

-- Likes -----------------------------------------------------------------------------

create table if not exists public.likes (
  video_id uuid not null references public.videos (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (video_id, user_id)
);

create index if not exists likes_user_idx on public.likes (user_id, created_at desc);

alter table public.likes enable row level security;

drop policy if exists "people read their own likes" on public.likes;
create policy "people read their own likes"
  on public.likes
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.likes from anon, authenticated;
grant select on public.likes to authenticated;

create or replace function public.likes_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  vid uuid := coalesce(new.video_id, old.video_id);
  step int := case when tg_op = 'INSERT' then 1 else -1 end;
  owner uuid;
begin
  update public.videos v
     set like_count = greatest(v.like_count + step, 0)
   where v.id = vid
  returning v.owner_id into owner;
  if owner is not null then
    update public.profiles p set like_count = greatest(p.like_count + step, 0) where p.id = owner;
  end if;
  return null;
end;
$$;

drop trigger if exists likes_count on public.likes;
create trigger likes_count
  after insert or delete on public.likes
  for each row execute function public.likes_count();

-- Likes or unlikes a clip. Answers { liked, like_count }.
-- Errors: not_signed_in, likes_off, banned, not_found
create or replace function public.toggle_like(p_video uuid, p_on boolean default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  has boolean;
  want boolean;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not public.flag_on('likes', me) then
    raise exception 'likes_off' using errcode = 'P0001';
  end if;
  if public.is_banned(me) then
    raise exception 'banned' using errcode = 'P0001';
  end if;
  if not public.video_is_visible(p_video) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  has := exists (select 1 from public.likes l where l.video_id = p_video and l.user_id = me);
  want := coalesce(p_on, not has);
  if want and not has then
    insert into public.likes (video_id, user_id) values (p_video, me) on conflict do nothing;
  elsif has and not want then
    delete from public.likes l where l.video_id = p_video and l.user_id = me;
  end if;

  return jsonb_build_object(
    'liked', want,
    'like_count', (select v.like_count from public.videos v where v.id = p_video)
  );
end;
$$;

-- Follows ---------------------------------------------------------------------------

create table if not exists public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_not_self check (follower_id <> followee_id)
);

create index if not exists follows_followee_idx on public.follows (followee_id, created_at desc);

alter table public.follows enable row level security;

drop policy if exists "follows are readable by everyone" on public.follows;
create policy "follows are readable by everyone"
  on public.follows
  for select
  to anon, authenticated
  using (true);

revoke all on public.follows from anon, authenticated;
grant select on public.follows to anon, authenticated;

create or replace function public.follows_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  step int := case when tg_op = 'INSERT' then 1 else -1 end;
begin
  update public.profiles p set follower_count = greatest(p.follower_count + step, 0)
   where p.id = coalesce(new.followee_id, old.followee_id);
  update public.profiles p set following_count = greatest(p.following_count + step, 0)
   where p.id = coalesce(new.follower_id, old.follower_id);
  return null;
end;
$$;

drop trigger if exists follows_count on public.follows;
create trigger follows_count
  after insert or delete on public.follows
  for each row execute function public.follows_count();

-- Follows or unfollows a creator. Answers { following, follower_count }.
-- Errors: not_signed_in, follows_off, banned, not_found, self
create or replace function public.toggle_follow(p_user uuid, p_on boolean default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  has boolean;
  want boolean;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not public.flag_on('follows', me) then
    raise exception 'follows_off' using errcode = 'P0001';
  end if;
  if public.is_banned(me) then
    raise exception 'banned' using errcode = 'P0001';
  end if;
  if p_user = me then
    raise exception 'self' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  has := exists (select 1 from public.follows f where f.follower_id = me and f.followee_id = p_user);
  want := coalesce(p_on, not has);
  if want and not has then
    insert into public.follows (follower_id, followee_id) values (me, p_user) on conflict do nothing;
  elsif has and not want then
    delete from public.follows f where f.follower_id = me and f.followee_id = p_user;
  end if;

  return jsonb_build_object(
    'following', want,
    'follower_count', (select p.follower_count from public.profiles p where p.id = p_user)
  );
end;
$$;

-- Comments --------------------------------------------------------------------------

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  -- Set by an admin (008_moderation.sql); a removed comment can be restored.
  removed_at timestamptz,
  removed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint comments_body_length check (char_length(body) between 1 and 500)
);

create index if not exists comments_video_idx on public.comments (video_id, created_at desc, id desc);
create index if not exists comments_author_idx on public.comments (author_id, created_at desc);

alter table public.comments enable row level security;

drop policy if exists "comments on readable clips are readable" on public.comments;
create policy "comments on readable clips are readable"
  on public.comments
  for select
  to anon, authenticated
  using (
    removed_at is null
    and not public.is_banned(author_id)
    and public.video_is_visible(video_id)
  );

revoke all on public.comments from anon, authenticated;
grant select (id, video_id, author_id, body, created_at) on public.comments to anon, authenticated;

-- videos.comment_count: the comments a visitor can read.
create or replace function public.comments_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  was_counted boolean := tg_op <> 'INSERT' and old.removed_at is null;
  is_counted boolean := tg_op <> 'DELETE' and new.removed_at is null;
begin
  if was_counted and not is_counted then
    update public.videos v set comment_count = greatest(v.comment_count - 1, 0) where v.id = old.video_id;
  elsif is_counted and not was_counted then
    update public.videos v set comment_count = v.comment_count + 1 where v.id = new.video_id;
  end if;
  return null;
end;
$$;

drop trigger if exists comments_count on public.comments;
create trigger comments_count
  after insert or update of removed_at or delete on public.comments
  for each row execute function public.comments_count();

-- Posts a comment. Answers the new comment the way video_comments() lists it.
-- Errors: not_signed_in, comments_off, banned, not_onboarded, not_found,
--   comment_invalid, slow_down (more than 6 comments in a minute)
create or replace function public.add_comment(p_video uuid, p_body text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  me_profile public.profiles;
  -- Line breaks become spaces: a comment is one short line.
  clean text := trim(both from regexp_replace(coalesce(p_body, ''), '[[:cntrl:]]+', ' ', 'g'));
  new_row public.comments;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not public.flag_on('comments', me)
     or coalesce(public.site_setting('comments_enabled'), 'true'::jsonb) = 'false'::jsonb then
    raise exception 'comments_off' using errcode = 'P0001';
  end if;
  select * into me_profile from public.profiles p where p.id = me;
  if me_profile.banned_at is not null then
    raise exception 'banned' using errcode = 'P0001';
  end if;
  if me_profile.id is null or not me_profile.onboarded then
    raise exception 'not_onboarded' using errcode = 'P0001';
  end if;
  if not public.video_is_visible(p_video) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if char_length(clean) not between 1 and 500 then
    raise exception 'comment_invalid' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('add_comment:' || me::text, 0));
  if (select count(*) from public.comments c
       where c.author_id = me and c.created_at > now() - interval '1 minute') >= 6 then
    raise exception 'slow_down' using errcode = 'P0001';
  end if;

  insert into public.comments (video_id, author_id, body)
  values (p_video, me, clean)
  returning * into new_row;

  return jsonb_build_object(
    'id', new_row.id,
    'body', new_row.body,
    'created_at', new_row.created_at,
    'author', jsonb_build_object(
      'id', me_profile.id,
      'username', me_profile.username,
      'display_name', me_profile.display_name,
      'avatar_url', me_profile.avatar_url,
      'verified', me_profile.verified
    ),
    'mine', true
  );
end;
$$;

-- The author, or the owner of the clip, deletes a comment for good.
-- Errors: not_signed_in, not_found
create or replace function public.delete_comment(p_comment uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  delete from public.comments c
   where c.id = p_comment
     and (c.author_id = me
          or exists (select 1 from public.videos v where v.id = c.video_id and v.owner_id = me));
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end;
$$;

-- One page of a clip's comments, newest first, with each author. Pass the
-- created_at and id of the last comment you have to get the next page.
create or replace function public.video_comments(
  p_video uuid,
  p_limit int default 30,
  p_before timestamptz default null,
  p_before_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row order by created_at desc, id desc), '[]'::jsonb)
  from (
    select c.created_at, c.id,
      jsonb_build_object(
        'id', c.id,
        'body', c.body,
        'created_at', c.created_at,
        'author', jsonb_build_object(
          'id', p.id,
          'username', p.username,
          'display_name', p.display_name,
          'avatar_url', p.avatar_url,
          'verified', p.verified
        ),
        'mine', c.author_id = (select auth.uid())
      ) as row
    from public.comments c
    join public.profiles p on p.id = c.author_id
    where c.video_id = p_video
      and c.removed_at is null
      and p.banned_at is null
      and public.video_is_visible(p_video)
      and public.flag_on('comments', (select auth.uid()))
      and (p_before is null or (c.created_at, c.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by c.created_at desc, c.id desc
    limit least(greatest(coalesce(p_limit, 30), 1), 50)
  ) page;
$$;

-- Who may call what ----------------------------------------------------------------

revoke execute on function public.likes_count() from public, anon, authenticated;
revoke execute on function public.follows_count() from public, anon, authenticated;
revoke execute on function public.comments_count() from public, anon, authenticated;
revoke execute on function public.toggle_like(uuid, boolean) from public, anon;
revoke execute on function public.toggle_follow(uuid, boolean) from public, anon;
revoke execute on function public.add_comment(uuid, text) from public, anon;
revoke execute on function public.delete_comment(uuid) from public, anon;
revoke execute on function public.video_comments(uuid, int, timestamptz, uuid) from public;
grant execute on function public.toggle_like(uuid, boolean) to authenticated;
grant execute on function public.toggle_follow(uuid, boolean) to authenticated;
grant execute on function public.add_comment(uuid, text) to authenticated;
grant execute on function public.delete_comment(uuid) to authenticated;
grant execute on function public.video_comments(uuid, int, timestamptz, uuid) to anon, authenticated;

insert into public.feature_flags (key, label, description, mode)
values
  ('likes', 'Likes', 'The heart on every clip and the like counts.', 'off'),
  ('follows', 'Follows', 'The follow button on clips and profiles, and the follower counts.', 'off'),
  ('comments', 'Comments', 'The comment drawer on every clip. The Comments site setting can pause new comments while this stays on.', 'off')
on conflict (key) do nothing;

-- ===== 007_feed.sql =====
-- 007_feed.sql
-- The For You feed, creator profiles, views and shares.
--
-- - feed_page() answers one page of clips, newest first, each with its
--   creator and with what the person asking has done (liked, following).
--   This session's feed is "newest first"; a ranked feed is a later session
--   and will only have to change this one function.
-- - profile_page() answers a creator and one page of their clips.
-- - record_view() counts a view once per viewer, clip and day, into
--   videos.view_count and the per day totals in video_views (the admin stats
--   page reads those).
-- - record_share() counts a tap on Share.
--
-- Run after 006_social.sql. Safe to run more than once.

-- One clip as the app shows it. viewer is null for a signed out visitor.
create or replace function public.video_card(v public.videos, viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', v.id,
    'caption', v.caption,
    'hashtags', to_jsonb(v.hashtags),
    'visibility', v.visibility,
    'status', v.status,
    'duration_s', v.duration_s,
    'width', v.width,
    'height', v.height,
    'hls_key', v.hls_key,
    'thumbnail_url', v.thumbnail_url,
    'like_count', v.like_count,
    'comment_count', v.comment_count,
    'view_count', v.view_count,
    'share_count', v.share_count,
    'published_at', v.published_at,
    'created_at', v.created_at,
    'removed', v.removed_at is not null,
    'author', jsonb_build_object(
      'id', p.id,
      'username', p.username,
      'display_name', p.display_name,
      'avatar_url', p.avatar_url,
      'verified', p.verified
    ),
    'liked', viewer is not null
      and exists (select 1 from public.likes l where l.video_id = v.id and l.user_id = viewer),
    'following', viewer is not null
      and exists (select 1 from public.follows f where f.follower_id = viewer and f.followee_id = v.owner_id),
    'mine', viewer is not null and v.owner_id = viewer
  )
  from public.profiles p
  where p.id = v.owner_id;
$$;

revoke execute on function public.video_card(public.videos, uuid) from public, anon, authenticated;

-- One page of the feed. Pass the published_at and id of the last clip you
-- have to get the next page. Empty while the feed flag is off for the caller.
create or replace function public.feed_page(
  p_limit int default 8,
  p_before timestamptz default null,
  p_before_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.video_card(v, (select auth.uid())) order by v.published_at desc, v.id desc), '[]'::jsonb)
  from (
    select x.*
    from public.videos x
    join public.profiles p on p.id = x.owner_id
    where x.visibility = 'public' and x.status = 'ready' and x.removed_at is null
      and p.banned_at is null
      and public.flag_on('feed', (select auth.uid()))
      and (p_before is null or (x.published_at, x.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by x.published_at desc, x.id desc
    limit least(greatest(coalesce(p_limit, 8), 1), 20)
  ) v;
$$;

-- One clip by id, for /v/<id>. Null when the caller may not see it. The owner
-- also gets their own clips that are private, still processing or removed.
create or replace function public.video_by_id(p_video uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.video_card(v, (select auth.uid()))
  from public.videos v
  where v.id = p_video
    and public.video_is_visible(v.id)
    and public.flag_on('feed', (select auth.uid()));
$$;

-- A creator and one page of their clips, newest first. The owner sees all of
-- their own clips, everyone else the ones in the feed. Null: no such account.
create or replace function public.profile_page(
  p_username text,
  p_limit int default 24,
  p_before timestamptz default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'profile', jsonb_build_object(
      'id', p.id,
      'username', p.username,
      'display_name', p.display_name,
      'avatar_url', p.avatar_url,
      'bio', p.bio,
      'verified', p.verified,
      'banned', p.banned_at is not null,
      'follower_count', p.follower_count,
      'following_count', p.following_count,
      'video_count', p.video_count,
      'like_count', p.like_count,
      'created_at', p.created_at
    ),
    'following', exists (
      select 1 from public.follows f where f.follower_id = (select auth.uid()) and f.followee_id = p.id
    ),
    'mine', p.id = (select auth.uid()),
    'videos', coalesce((
      select jsonb_agg(public.video_card(v, (select auth.uid())) order by v.created_at desc, v.id desc)
      from (
        select x.*
        from public.videos x
        where x.owner_id = p.id
          and (
            x.owner_id = (select auth.uid())
            or (x.visibility = 'public' and x.status = 'ready' and x.removed_at is null and p.banned_at is null)
          )
          and (p_before is null or x.created_at < p_before)
        order by x.created_at desc, x.id desc
        limit least(greatest(coalesce(p_limit, 24), 1), 60)
      ) v
    ), '[]'::jsonb)
  )
  from public.profiles p
  where lower(p.username) = lower(p_username)
    and public.flag_on('profiles', (select auth.uid()));
$$;

-- Views -----------------------------------------------------------------------------

-- Per day totals, for the stats page.
create table if not exists public.video_views (
  video_id uuid not null references public.videos (id) on delete cascade,
  day date not null,
  views int not null default 0,
  primary key (video_id, day)
);

create index if not exists video_views_day_idx on public.video_views (day);

alter table public.video_views enable row level security;
revoke all on public.video_views from anon, authenticated;

-- Who already counted today. viewer is the account id, or for a signed out
-- visitor the hash of a random key their browser keeps. Rows older than two
-- days are swept by record_view itself.
create table if not exists public.video_view_log (
  video_id uuid not null references public.videos (id) on delete cascade,
  viewer text not null,
  day date not null default current_date,
  primary key (video_id, viewer, day)
);

create index if not exists video_view_log_day_idx on public.video_view_log (day);

alter table public.video_view_log enable row level security;
revoke all on public.video_view_log from anon, authenticated;

-- Counts one view. True when it counted, false when this viewer already
-- watched this clip today (or the clip is not visible). Never raises, so the
-- player can fire and forget.
-- A signed out visitor could make up new keys to count again; a view count
-- that resists that is a later session (it needs rate limits by address).
create or replace function public.record_view(p_video uuid, p_viewer_key text default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  who text;
  added int;
begin
  if me is not null then
    who := me::text;
  elsif p_viewer_key ~ '^[A-Za-z0-9_-]{16,64}$' then
    who := 'anon:' || md5(p_viewer_key);
  else
    return false;
  end if;
  if not public.video_is_visible(p_video) or not public.flag_on('feed', me) then
    return false;
  end if;

  insert into public.video_view_log (video_id, viewer) values (p_video, who)
  on conflict do nothing;
  get diagnostics added = row_count;
  if added = 0 then
    return false;
  end if;

  update public.videos v set view_count = v.view_count + 1 where v.id = p_video;
  insert into public.video_views (video_id, day, views) values (p_video, current_date, 1)
  on conflict (video_id, day) do update set views = public.video_views.views + 1;

  if random() < 0.01 then
    delete from public.video_view_log l where l.day < current_date - 2;
  end if;
  return true;
end;
$$;

-- Counts a tap on Share. Signed in only, so the number means something.
create or replace function public.record_share(p_video uuid)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  total int;
begin
  if me is null or public.is_banned(me) or not public.flag_on('share', me)
     or not public.video_is_visible(p_video) then
    return null;
  end if;
  update public.videos v set share_count = v.share_count + 1 where v.id = p_video
  returning v.share_count into total;
  return total;
end;
$$;

-- Who may call what ----------------------------------------------------------------

revoke execute on function public.feed_page(int, timestamptz, uuid) from public;
revoke execute on function public.video_by_id(uuid) from public;
revoke execute on function public.profile_page(text, int, timestamptz) from public;
revoke execute on function public.record_view(uuid, text) from public;
revoke execute on function public.record_share(uuid) from public, anon;
grant execute on function public.feed_page(int, timestamptz, uuid) to anon, authenticated;
grant execute on function public.video_by_id(uuid) to anon, authenticated;
grant execute on function public.profile_page(text, int, timestamptz) to anon, authenticated;
grant execute on function public.record_view(uuid, text) to anon, authenticated;
grant execute on function public.record_share(uuid) to authenticated;

insert into public.feature_flags (key, label, description, mode)
values
  ('feed', 'For You feed', 'The full screen vertical feed on the home page and the single clip page /v/<id>.', 'off'),
  ('profiles', 'Creator profiles', 'The creator page at /@username with their clips and counts.', 'off'),
  ('share', 'Share', 'The share button on every clip: copy the link or use the phone share sheet.', 'off'),
  ('search', 'Search', 'Search for clips and creators. Not built yet: a later session.', 'off'),
  ('hashtags', 'Hashtag pages', 'A page of clips per hashtag. Hashtags are already saved on upload; the pages are a later session.', 'off'),
  ('sounds', 'Sounds', 'Pick a sound for a clip and browse clips by sound. Not built yet: a later session.', 'off')
on conflict (key) do nothing;

-- ===== 008_moderation.sql =====
-- 008_moderation.sql
-- Moderation basics: reports from people, and what an admin can do about them.
--
-- - report_content() files a report on a clip or a comment. One open report
--   per person and target; ten reports per person per hour.
-- - Admins remove and restore clips and comments, ban and unban accounts,
--   mark accounts verified or invited, and close reports.
-- - Every one of those starts with require_admin() and ends with a row in
--   admin_log. There is no other way to do them: the tables have no write
--   policies.
-- - A banned account cannot upload, like, follow, comment or report (each
--   function checks), its clips and comments drop out of every list, and
--   proxy.ts signs it out on its next page.
--
-- Run after 007_feed.sql. Safe to run more than once.

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  target_type text not null,
  video_id uuid references public.videos (id) on delete cascade,
  comment_id uuid references public.comments (id) on delete cascade,
  reason text not null,
  note text not null default '',
  status text not null default 'open',
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint reports_target_type_valid check (target_type in ('video', 'comment')),
  constraint reports_target_set check (
    (target_type = 'video' and video_id is not null and comment_id is null)
    or (target_type = 'comment' and comment_id is not null)
  ),
  constraint reports_reason_valid check (
    reason in ('spam', 'nudity', 'violence', 'harassment', 'hate', 'dangerous', 'minor_safety', 'copyright', 'other')
  ),
  constraint reports_note_length check (char_length(note) <= 500),
  constraint reports_status_valid check (status in ('open', 'actioned', 'dismissed'))
);

create index if not exists reports_open_idx on public.reports (created_at desc) where status = 'open';
create index if not exists reports_reporter_idx on public.reports (reporter_id, created_at desc);
create unique index if not exists reports_one_open_video on public.reports (reporter_id, video_id)
  where status = 'open' and target_type = 'video';
create unique index if not exists reports_one_open_comment on public.reports (reporter_id, comment_id)
  where status = 'open' and target_type = 'comment';

alter table public.reports enable row level security;
-- Read through admin_reports() (009). No policies, no grants.
revoke all on public.reports from anon, authenticated;

-- Files a report. Answers 'reported', or 'already' when this person has an
-- open report on the same thing.
-- Errors: not_signed_in, reports_off, banned, bad_target, bad_reason,
--   note_too_long, not_found, slow_down
create or replace function public.report_content(
  p_type text,
  p_id uuid,
  p_reason text,
  p_note text default ''
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  clean_note text := trim(both from coalesce(p_note, ''));
  vid uuid;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not public.flag_on('reports', me) then
    raise exception 'reports_off' using errcode = 'P0001';
  end if;
  if public.is_banned(me) then
    raise exception 'banned' using errcode = 'P0001';
  end if;
  if p_type is null or p_type not in ('video', 'comment') then
    raise exception 'bad_target' using errcode = 'P0001';
  end if;
  if p_reason is null or p_reason not in
     ('spam', 'nudity', 'violence', 'harassment', 'hate', 'dangerous', 'minor_safety', 'copyright', 'other') then
    raise exception 'bad_reason' using errcode = 'P0001';
  end if;
  if char_length(clean_note) > 500 then
    raise exception 'note_too_long' using errcode = 'P0001';
  end if;

  if p_type = 'video' then
    vid := p_id;
  else
    select c.video_id into vid from public.comments c where c.id = p_id and c.removed_at is null;
  end if;
  if vid is null or not public.video_is_visible(vid) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('report:' || me::text, 0));
  if (select count(*) from public.reports r
       where r.reporter_id = me and r.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'slow_down' using errcode = 'P0001';
  end if;

  begin
    insert into public.reports (reporter_id, target_type, video_id, comment_id, reason, note)
    values (me, p_type, vid, case when p_type = 'comment' then p_id end, p_reason, clean_note);
  exception when unique_violation then
    return 'already';
  end;
  return 'reported';
end;
$$;

-- Admin actions ---------------------------------------------------------------------

-- Closes every open report on a clip or comment once an admin acted on it.
create or replace function public.reports_close_for(actor uuid, p_type text, p_id uuid, p_status text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.reports r
     set status = p_status, resolved_by = actor, resolved_at = now()
   where r.status = 'open'
     and r.target_type = p_type
     and ((p_type = 'video' and r.video_id = p_id) or (p_type = 'comment' and r.comment_id = p_id));
$$;

-- Hides a clip from everyone but its owner and admins. Open reports on it
-- are closed as actioned. Errors: not_signed_in, not_admin, not_found
create or replace function public.admin_remove_video(p_video uuid, p_reason text default '')
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_admin();
  clean text := left(trim(both from coalesce(p_reason, '')), 200);
begin
  update public.videos v
     set removed_at = coalesce(v.removed_at, now()), removed_by = me, removed_reason = clean
   where v.id = p_video;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform public.reports_close_for(me, 'video', p_video, 'actioned');
  perform public.admin_log_add(me, 'video.remove', 'video', p_video::text, jsonb_build_object('reason', clean));
end;
$$;

create or replace function public.admin_restore_video(p_video uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_admin();
begin
  update public.videos v
     set removed_at = null, removed_by = null, removed_reason = null
   where v.id = p_video;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform public.admin_log_add(me, 'video.restore', 'video', p_video::text);
end;
$$;

create or replace function public.admin_remove_comment(p_comment uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_admin();
begin
  update public.comments c
     set removed_at = coalesce(c.removed_at, now()), removed_by = me
   where c.id = p_comment;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform public.reports_close_for(me, 'comment', p_comment, 'actioned');
  perform public.admin_log_add(me, 'comment.remove', 'comment', p_comment::text);
end;
$$;

create or replace function public.admin_restore_comment(p_comment uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_admin();
begin
  update public.comments c set removed_at = null, removed_by = null where c.id = p_comment;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform public.admin_log_add(me, 'comment.restore', 'comment', p_comment::text);
end;
$$;

-- Closes one report without touching what it is about.
-- Errors: not_signed_in, not_admin, not_found
create or replace function public.admin_dismiss_report(p_report uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_admin();
begin
  update public.reports r
     set status = 'dismissed', resolved_by = me, resolved_at = now()
   where r.id = p_report and r.status = 'open';
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform public.admin_log_add(me, 'report.dismiss', 'report', p_report::text);
end;
$$;

-- Bans an account. Errors: not_signed_in, not_admin, not_found, self,
--   is_admin (take them out of the admins table first)
create or replace function public.admin_ban(p_user uuid, p_reason text default '')
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_admin();
  clean text := left(trim(both from coalesce(p_reason, '')), 200);
begin
  if p_user = me then
    raise exception 'self' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.admins a where a.user_id = p_user) then
    raise exception 'is_admin' using errcode = 'P0001';
  end if;
  update public.profiles p
     set banned_at = coalesce(p.banned_at, now()), banned_by = me, banned_reason = clean
   where p.id = p_user;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform public.admin_log_add(me, 'account.ban', 'account', p_user::text, jsonb_build_object('reason', clean));
end;
$$;

create or replace function public.admin_unban(p_user uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_admin();
begin
  update public.profiles p
     set banned_at = null, banned_by = null, banned_reason = null
   where p.id = p_user;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform public.admin_log_add(me, 'account.unban', 'account', p_user::text);
end;
$$;

-- Sets the verified or the invited mark on an account. They decide who may
-- upload when the upload_who setting is "verified" or "invite".
-- Errors: not_signed_in, not_admin, bad_mark, not_found
create or replace function public.admin_set_mark(p_user uuid, p_mark text, p_on boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_admin();
begin
  if p_mark is null or p_mark not in ('verified', 'invited') or p_on is null then
    raise exception 'bad_mark' using errcode = 'P0001';
  end if;
  if p_mark = 'verified' then
    update public.profiles p set verified = p_on where p.id = p_user;
  else
    update public.profiles p set invited = p_on where p.id = p_user;
  end if;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform public.admin_log_add(me, 'account.' || p_mark, 'account', p_user::text, jsonb_build_object('on', p_on));
end;
$$;

-- Who may call what ----------------------------------------------------------------

revoke execute on function public.reports_close_for(uuid, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.report_content(text, uuid, text, text) from public, anon;
revoke execute on function public.admin_remove_video(uuid, text) from public, anon;
revoke execute on function public.admin_restore_video(uuid) from public, anon;
revoke execute on function public.admin_remove_comment(uuid) from public, anon;
revoke execute on function public.admin_restore_comment(uuid) from public, anon;
revoke execute on function public.admin_dismiss_report(uuid) from public, anon;
revoke execute on function public.admin_ban(uuid, text) from public, anon;
revoke execute on function public.admin_unban(uuid) from public, anon;
revoke execute on function public.admin_set_mark(uuid, text, boolean) from public, anon;
grant execute on function public.report_content(text, uuid, text, text) to authenticated;
grant execute on function public.admin_remove_video(uuid, text) to authenticated;
grant execute on function public.admin_restore_video(uuid) to authenticated;
grant execute on function public.admin_remove_comment(uuid) to authenticated;
grant execute on function public.admin_restore_comment(uuid) to authenticated;
grant execute on function public.admin_dismiss_report(uuid) to authenticated;
grant execute on function public.admin_ban(uuid, text) to authenticated;
grant execute on function public.admin_unban(uuid) to authenticated;
grant execute on function public.admin_set_mark(uuid, text, boolean) to authenticated;

insert into public.feature_flags (key, label, description, mode)
values
  ('reports', 'Reports', 'The report button on clips and comments. Reports land in the queue at /admin/reports.', 'off')
on conflict (key) do nothing;

-- ===== 009_admin_panel.sql =====
-- 009_admin_panel.sql
-- What the pages under /admin read. Each function starts with
-- require_admin(), so the lists are empty-handed for everyone else: the
-- tables behind them (admin_log, reports, the ban columns) have no read
-- access through the API at all.
--
-- Run after 008_moderation.sql. Safe to run more than once.

-- A short "who" for the lists: { id, username } or null.
create or replace function public.admin_who(uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'username', p.username)
  from public.profiles p where p.id = uid;
$$;

-- Every flag, with who changed it last and when.
create or replace function public.admin_flags()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_admin();
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'key', f.key,
      'label', f.label,
      'description', f.description,
      'mode', f.mode,
      'testers', cardinality(f.users),
      'me_listed', me = any (f.users),
      'updated_at', f.updated_at,
      'updated_by', public.admin_who(f.updated_by)
    ) order by f.key), '[]'::jsonb)
    from public.feature_flags f
  );
end;
$$;

-- Every site setting, with who changed it last and when.
create or replace function public.admin_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'key', s.key,
      'label', s.label,
      'description', s.description,
      'kind', s.kind,
      'value', s.value,
      'options', s.options,
      'min', s.min_value,
      'max', s.max_value,
      'updated_at', s.updated_at,
      'updated_by', public.admin_who(s.updated_by)
    ) order by s.sort, s.key), '[]'::jsonb)
    from public.site_settings s
  );
end;
$$;

-- The reports queue: 'open' (oldest first) or 'closed' (newest first).
create or replace function public.admin_reports(p_status text default 'open', p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return (
    select coalesce(jsonb_agg(row), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id', r.id,
        'target_type', r.target_type,
        'reason', r.reason,
        'note', r.note,
        'status', r.status,
        'created_at', r.created_at,
        'resolved_at', r.resolved_at,
        'reporter', public.admin_who(r.reporter_id),
        'resolved_by', public.admin_who(r.resolved_by),
        'video', jsonb_build_object(
          'id', v.id,
          'caption', v.caption,
          'thumbnail_url', v.thumbnail_url,
          'removed', v.removed_at is not null,
          'owner', public.admin_who(v.owner_id)
        ),
        'comment', case when c.id is null then null else jsonb_build_object(
          'id', c.id,
          'body', c.body,
          'removed', c.removed_at is not null,
          'author', public.admin_who(c.author_id)
        ) end
      ) as row
      from public.reports r
      join public.videos v on v.id = r.video_id
      left join public.comments c on c.id = r.comment_id
      where (p_status = 'open' and r.status = 'open')
         or (p_status <> 'open' and r.status <> 'open')
      order by
        case when p_status = 'open' then r.created_at end asc,
        case when p_status <> 'open' then r.resolved_at end desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) page
  );
end;
$$;

-- Clips for /admin/videos, newest first. p_state: 'all', 'live', 'removed',
-- 'processing' or 'failed'. p_q matches the caption, a hashtag, the creator's
-- username or the clip id.
create or replace function public.admin_videos(p_q text default '', p_state text default 'all', p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q text := lower(trim(both from coalesce(p_q, '')));
begin
  perform public.require_admin();
  return (
    select coalesce(jsonb_agg(row), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id', v.id,
        'caption', v.caption,
        'hashtags', to_jsonb(v.hashtags),
        'status', v.status,
        'visibility', v.visibility,
        'thumbnail_url', v.thumbnail_url,
        'duration_s', v.duration_s,
        'error', v.error,
        'view_count', v.view_count,
        'like_count', v.like_count,
        'comment_count', v.comment_count,
        'created_at', v.created_at,
        'removed', v.removed_at is not null,
        'removed_at', v.removed_at,
        'removed_reason', v.removed_reason,
        'owner', public.admin_who(v.owner_id),
        'open_reports', (select count(*) from public.reports r where r.video_id = v.id and r.status = 'open')
      ) as row
      from public.videos v
      join public.profiles p on p.id = v.owner_id
      where (
          p_state = 'all'
          or (p_state = 'live' and v.status = 'ready' and v.removed_at is null and v.visibility = 'public')
          or (p_state = 'removed' and v.removed_at is not null)
          or (p_state = 'processing' and v.status in ('uploading', 'uploaded', 'processing'))
          or (p_state = 'failed' and v.status = 'failed')
        )
        and (
          q = ''
          or position(q in lower(v.caption)) > 0
          or v.hashtags @> array[regexp_replace(q, '^#', '')]
          or lower(p.username) = regexp_replace(q, '^@', '')
          or v.id::text = q
        )
      order by v.created_at desc, v.id desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) page
  );
end;
$$;

-- Accounts for /admin/accounts, newest first. p_q matches the start of the
-- username or the display name, or the account id.
create or replace function public.admin_accounts(p_q text default '', p_state text default 'all', p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q text := lower(regexp_replace(trim(both from coalesce(p_q, '')), '^@', ''));
begin
  perform public.require_admin();
  return (
    select coalesce(jsonb_agg(row), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id', p.id,
        'username', p.username,
        'display_name', p.display_name,
        'avatar_url', p.avatar_url,
        'verified', p.verified,
        'invited', p.invited,
        'onboarded', p.onboarded,
        'banned', p.banned_at is not null,
        'banned_at', p.banned_at,
        'banned_reason', p.banned_reason,
        'is_admin', exists (select 1 from public.admins a where a.user_id = p.id),
        'video_count', p.video_count,
        'follower_count', p.follower_count,
        'created_at', p.created_at
      ) as row
      from public.profiles p
      where (
          p_state = 'all'
          or (p_state = 'banned' and p.banned_at is not null)
          or (p_state = 'verified' and p.verified)
          or (p_state = 'invited' and p.invited)
        )
        and (
          q = ''
          or lower(p.username) like replace(replace(q, '%', ''), '_', '\_') || '%'
          or lower(p.display_name) like replace(replace(q, '%', ''), '_', '\_') || '%'
          or p.id::text = q
        )
      order by p.created_at desc, p.id desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) page
  );
end;
$$;

-- The audit log, newest first. Pass the id of the last row you have to get
-- the next page.
create or replace function public.admin_log_page(p_limit int default 50, p_before bigint default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return (
    select coalesce(jsonb_agg(row), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id', l.id,
        'action', l.action,
        'target_type', l.target_type,
        'target_id', l.target_id,
        'details', l.details,
        'created_at', l.created_at,
        'actor', public.admin_who(l.actor_id),
        -- A readable name for the target where there is one.
        'target_name', case l.target_type
          when 'account' then (select '@' || p.username from public.profiles p where p.id::text = l.target_id)
          when 'video' then (select nullif(left(v.caption, 60), '') from public.videos v where v.id::text = l.target_id)
          else null
        end
      ) as row
      from public.admin_log l
      where p_before is null or l.id < p_before
      order by l.id desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) page
  );
end;
$$;

-- Sign-ups, uploads and views per day (UTC) for the last p_days days, oldest
-- first, plus the totals and what is waiting for an admin.
create or replace function public.admin_stats(p_days int default 14)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  n int := least(greatest(coalesce(p_days, 14), 1), 90);
  today date := (now() at time zone 'utc')::date;
begin
  perform public.require_admin();
  return jsonb_build_object(
    'days', (
      select jsonb_agg(jsonb_build_object(
        'day', d.day,
        'signups', (select count(*) from public.profiles p
                     where (p.created_at at time zone 'utc')::date = d.day),
        'uploads', (select count(*) from public.videos v
                     where (v.created_at at time zone 'utc')::date = d.day and v.status <> 'failed'),
        'views', (select coalesce(sum(w.views), 0) from public.video_views w where w.day = d.day)
      ) order by d.day)
      from (select generate_series(today - (n - 1), today, interval '1 day')::date as day) d
    ),
    'totals', jsonb_build_object(
      'accounts', (select count(*) from public.profiles),
      'clips', (select count(*) from public.videos v where v.status = 'ready' and v.removed_at is null),
      'views', (select coalesce(sum(v.view_count), 0) from public.videos v),
      'open_reports', (select count(*) from public.reports r where r.status = 'open'),
      'banned', (select count(*) from public.profiles p where p.banned_at is not null),
      'in_queue', (select count(*) from public.encode_jobs j where j.status in ('queued', 'running')),
      'failed', (select count(*) from public.videos v where v.status = 'failed' and v.created_at > now() - interval '7 days')
    )
  );
end;
$$;

revoke execute on function public.admin_who(uuid) from public, anon, authenticated;
revoke execute on function public.admin_flags() from public, anon;
revoke execute on function public.admin_settings() from public, anon;
revoke execute on function public.admin_reports(text, int) from public, anon;
revoke execute on function public.admin_videos(text, text, int) from public, anon;
revoke execute on function public.admin_accounts(text, text, int) from public, anon;
revoke execute on function public.admin_log_page(int, bigint) from public, anon;
revoke execute on function public.admin_stats(int) from public, anon;
grant execute on function public.admin_flags() to authenticated;
grant execute on function public.admin_settings() to authenticated;
grant execute on function public.admin_reports(text, int) to authenticated;
grant execute on function public.admin_videos(text, text, int) to authenticated;
grant execute on function public.admin_accounts(text, text, int) to authenticated;
grant execute on function public.admin_log_page(int, bigint) to authenticated;
grant execute on function public.admin_stats(int) to authenticated;

-- ===== 010_player.sql =====
-- 010_player.sql
-- Flags for the player's touch controls. Nothing else changes in the
-- database: these features live in the browser (lib/feed/gestures.ts).
--
-- Run after 009_admin_panel.sql. Safe to run more than once.

insert into public.feature_flags (key, label, description, mode)
values
  ('gestures', 'Player gestures', 'Double tap a clip to like it, hold a finger on it to pause, hold the right side to play at double speed.', 'off'),
  ('scrub', 'Scrub bar', 'The bar at the bottom of a clip can be dragged to move through it.', 'off')
on conflict (key) do nothing;

-- ===== 011_following.sql =====
-- 011_following.sql
-- The Following feed: clips from the creators the person follows, newest
-- first. Same shape and paging as feed_page() in 007_feed.sql.
--
-- Run after 010_player.sql. Safe to run more than once.

-- One page of the Following feed. Empty for a signed out visitor, and while
-- the following flag (or the feed flag) is off for the caller.
create or replace function public.following_page(
  p_limit int default 8,
  p_before timestamptz default null,
  p_before_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.video_card(v, (select auth.uid())) order by v.published_at desc, v.id desc), '[]'::jsonb)
  from (
    select x.*
    from public.videos x
    join public.profiles p on p.id = x.owner_id
    join public.follows f on f.followee_id = x.owner_id and f.follower_id = (select auth.uid())
    where x.visibility = 'public' and x.status = 'ready' and x.removed_at is null
      and p.banned_at is null
      and public.flag_on('feed', (select auth.uid()))
      and public.flag_on('following', (select auth.uid()))
      and (p_before is null or (x.published_at, x.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by x.published_at desc, x.id desc
    limit least(greatest(coalesce(p_limit, 8), 1), 20)
  ) v;
$$;

revoke execute on function public.following_page(int, timestamptz, uuid) from public, anon;
grant execute on function public.following_page(int, timestamptz, uuid) to authenticated;

insert into public.feature_flags (key, label, description, mode)
values
  ('following', 'Following feed', 'A second feed at /following with clips from the creators you follow, and the For You / Following switch on top of the feed. Needs Follows.', 'off')
on conflict (key) do nothing;

-- ===== 012_saves.sql =====
-- 012_saves.sql
-- Saving clips for later, and the owner's Liked and Saved lists.
--
-- - saves is private: you can read your own, nobody else can.
-- - toggle_save() is the only way to write it, like toggle_like() in 006.
-- - Every clip card now also says whether the person asking saved it, and how
--   many people did (video_card is replaced with the two extra fields).
-- - my_clips('liked' | 'saved') lists the caller's own liked or saved clips,
--   most recent first, for the two extra tabs on their profile. Clips that
--   were removed, made private or belong to a banned creator drop out.
--
-- Run after 011_following.sql. Safe to run more than once.

alter table public.videos add column if not exists save_count int not null default 0;

create table if not exists public.saves (
  video_id uuid not null references public.videos (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (video_id, user_id)
);

create index if not exists saves_user_idx on public.saves (user_id, created_at desc);

alter table public.saves enable row level security;

drop policy if exists "people read their own saves" on public.saves;
create policy "people read their own saves"
  on public.saves
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.saves from anon, authenticated;
grant select on public.saves to authenticated;

create or replace function public.saves_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.videos v
     set save_count = greatest(v.save_count + case when tg_op = 'INSERT' then 1 else -1 end, 0)
   where v.id = coalesce(new.video_id, old.video_id);
  return null;
end;
$$;

drop trigger if exists saves_count on public.saves;
create trigger saves_count
  after insert or delete on public.saves
  for each row execute function public.saves_count();

-- Saves a clip or takes it out again. Answers { saved, save_count }.
-- Errors: not_signed_in, saves_off, banned, not_found
create or replace function public.toggle_save(p_video uuid, p_on boolean default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  has boolean;
  want boolean;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not public.flag_on('saves', me) then
    raise exception 'saves_off' using errcode = 'P0001';
  end if;
  if public.is_banned(me) then
    raise exception 'banned' using errcode = 'P0001';
  end if;
  if not public.video_is_visible(p_video) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  has := exists (select 1 from public.saves s where s.video_id = p_video and s.user_id = me);
  want := coalesce(p_on, not has);
  if want and not has then
    insert into public.saves (video_id, user_id) values (p_video, me) on conflict do nothing;
  elsif has and not want then
    delete from public.saves s where s.video_id = p_video and s.user_id = me;
  end if;

  return jsonb_build_object(
    'saved', want,
    'save_count', (select v.save_count from public.videos v where v.id = p_video)
  );
end;
$$;

-- One clip as the app shows it, now with saved and save_count.
create or replace function public.video_card(v public.videos, viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', v.id,
    'caption', v.caption,
    'hashtags', to_jsonb(v.hashtags),
    'visibility', v.visibility,
    'status', v.status,
    'duration_s', v.duration_s,
    'width', v.width,
    'height', v.height,
    'hls_key', v.hls_key,
    'thumbnail_url', v.thumbnail_url,
    'like_count', v.like_count,
    'comment_count', v.comment_count,
    'view_count', v.view_count,
    'share_count', v.share_count,
    'save_count', v.save_count,
    'published_at', v.published_at,
    'created_at', v.created_at,
    'removed', v.removed_at is not null,
    'author', jsonb_build_object(
      'id', p.id,
      'username', p.username,
      'display_name', p.display_name,
      'avatar_url', p.avatar_url,
      'verified', p.verified
    ),
    'liked', viewer is not null
      and exists (select 1 from public.likes l where l.video_id = v.id and l.user_id = viewer),
    'following', viewer is not null
      and exists (select 1 from public.follows f where f.follower_id = viewer and f.followee_id = v.owner_id),
    'saved', viewer is not null
      and exists (select 1 from public.saves s where s.video_id = v.id and s.user_id = viewer),
    'mine', viewer is not null and v.owner_id = viewer
  )
  from public.profiles p
  where p.id = v.owner_id;
$$;

revoke execute on function public.video_card(public.videos, uuid) from public, anon, authenticated;

-- The caller's own liked or saved clips, most recent first. Pass the "at" of
-- the last one you have to get the next page. Each row is a clip card plus
-- "at": when it was liked or saved.
create or replace function public.my_clips(p_kind text, p_limit int default 24, p_before timestamptz default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.video_card(v, (select auth.uid())) || jsonb_build_object('at', picked.at) order by picked.at desc), '[]'::jsonb)
  from (
    select l.video_id, l.created_at as at from public.likes l
     where p_kind = 'liked' and l.user_id = (select auth.uid()) and public.flag_on('likes', (select auth.uid()))
    union all
    select s.video_id, s.created_at from public.saves s
     where p_kind = 'saved' and s.user_id = (select auth.uid()) and public.flag_on('saves', (select auth.uid()))
  ) picked
  join public.videos v on v.id = picked.video_id
  join public.profiles p on p.id = v.owner_id
  where v.visibility = 'public' and v.status = 'ready' and v.removed_at is null and p.banned_at is null
    and (p_before is null or picked.at < p_before)
    and picked.video_id in (
      select x.video_id from (
        select l.video_id, l.created_at as at from public.likes l where p_kind = 'liked' and l.user_id = (select auth.uid())
        union all
        select s.video_id, s.created_at from public.saves s where p_kind = 'saved' and s.user_id = (select auth.uid())
      ) x
      where p_before is null or x.at < p_before
      order by x.at desc
      limit least(greatest(coalesce(p_limit, 24), 1), 60)
    );
$$;

revoke execute on function public.saves_count() from public, anon, authenticated;
revoke execute on function public.toggle_save(uuid, boolean) from public, anon;
revoke execute on function public.my_clips(text, int, timestamptz) from public, anon;
grant execute on function public.toggle_save(uuid, boolean) to authenticated;
grant execute on function public.my_clips(text, int, timestamptz) to authenticated;

insert into public.feature_flags (key, label, description, mode)
values
  ('saves', 'Saves', 'The bookmark on every clip, and the Liked and Saved tabs on your own profile.', 'off')
on conflict (key) do nothing;

-- ===== 013_discover.sql =====
-- 013_discover.sql
-- Finding things: hashtag pages, search and the Discover page.
--
-- - hashtag_page('cats') answers the clips with that hashtag, newest first,
--   and how many there are (the hashtags flag).
-- - search_all('text') answers people, hashtags and clips that match (the
--   search flag). Plain matching for now: the start of a username or name, a
--   hashtag that starts with the text, a caption that contains it. Good for
--   thousands of clips; a proper text index is a later migration.
-- - discover_page() answers what is popular: hashtags by clips in the last 30
--   days, creators by followers, clips by views in the last 7 days (the
--   discover flag).
-- Everything here only ever lists clips that are in the feed (public, ready,
-- not removed, creator not banned), with the same clip card as the feed.
--
-- Run after 012_saves.sql. Safe to run more than once.

-- Text typed by a person, safe inside a LIKE pattern.
create or replace function public.like_escape(t text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(coalesce(t, ''), '\', '\\'), '%', '\%'), '_', '\_');
$$;

-- Is this clip in the feed? The same rule as the feed policy in 004.
create or replace function public.video_is_live(v public.videos)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select v.visibility = 'public' and v.status = 'ready' and v.removed_at is null
    and not exists (select 1 from public.profiles p where p.id = v.owner_id and p.banned_at is not null);
$$;

create or replace function public.hashtag_page(
  p_tag text,
  p_limit int default 24,
  p_before timestamptz default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with tag as (select lower(regexp_replace(coalesce(p_tag, ''), '^#+', '')) as t)
  select case when not public.flag_on('hashtags', (select auth.uid())) or (select t from tag) !~ '^[a-z0-9_]{1,30}$' then null
  else jsonb_build_object(
    'tag', (select t from tag),
    'clip_count', (select count(*) from public.videos v where public.video_is_live(v) and v.hashtags @> array[(select t from tag)]),
    'view_count', (select coalesce(sum(v.view_count), 0) from public.videos v where public.video_is_live(v) and v.hashtags @> array[(select t from tag)]),
    'videos', coalesce((
      select jsonb_agg(public.video_card(x, (select auth.uid())) order by x.published_at desc, x.id desc)
      from (
        select v.* from public.videos v
        where public.video_is_live(v) and v.hashtags @> array[(select t from tag)]
          and (p_before is null or v.published_at < p_before)
        order by v.published_at desc, v.id desc
        limit least(greatest(coalesce(p_limit, 24), 1), 60)
      ) x
    ), '[]'::jsonb)
  ) end;
$$;

-- Hashtags by how many clips used them in the last p_days days.
create or replace function public.trending_hashtags(p_limit int default 12, p_days int default 30)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('tag', tag, 'clips', clips, 'views', views) order by clips desc, views desc, tag), '[]'::jsonb)
  from (
    select t.tag, count(*) as clips, sum(v.view_count) as views
    from public.videos v, unnest(v.hashtags) as t(tag)
    where public.video_is_live(v) and v.published_at > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365))
    group by t.tag
    order by count(*) desc, sum(v.view_count) desc, t.tag
    limit least(greatest(coalesce(p_limit, 12), 1), 50)
  ) top;
$$;

-- A creator as a small card, for search and Discover.
create or replace function public.creator_card(p public.profiles, viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'username', p.username,
    'display_name', p.display_name,
    'avatar_url', p.avatar_url,
    'verified', p.verified,
    'follower_count', p.follower_count,
    'video_count', p.video_count,
    'following', viewer is not null
      and exists (select 1 from public.follows f where f.follower_id = viewer and f.followee_id = p.id),
    'mine', viewer is not null and p.id = viewer
  );
$$;

-- People, hashtags and clips that match. Null while the search flag is off;
-- empty lists for a query shorter than two characters.
create or replace function public.search_all(p_q text, p_limit int default 18)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  q text := lower(trim(both from regexp_replace(coalesce(p_q, ''), '^[#@]+', '')));
  pat text := public.like_escape(q);
  n int := least(greatest(coalesce(p_limit, 18), 1), 40);
begin
  if not public.flag_on('search', me) then
    return null;
  end if;
  if char_length(q) < 2 or char_length(q) > 60 then
    return jsonb_build_object('q', q, 'people', '[]'::jsonb, 'tags', '[]'::jsonb, 'clips', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'q', q,
    'people', coalesce((
      select jsonb_agg(public.creator_card(p, me) order by p.follower_count desc, p.username)
      from (
        select x.* from public.profiles x
        where x.banned_at is null and x.onboarded
          and (lower(x.username) like pat || '%' or lower(x.display_name) like '%' || pat || '%')
        order by x.follower_count desc, x.username
        limit 8
      ) p
    ), '[]'::jsonb),
    'tags', coalesce((
      select jsonb_agg(jsonb_build_object('tag', tag, 'clips', clips) order by clips desc, tag)
      from (
        select t.tag, count(*) as clips
        from public.videos v, unnest(v.hashtags) as t(tag)
        where public.video_is_live(v) and t.tag like pat || '%'
        group by t.tag
        order by count(*) desc, t.tag
        limit 8
      ) tags
    ), '[]'::jsonb),
    'clips', coalesce((
      select jsonb_agg(public.video_card(x, me) order by x.view_count desc, x.published_at desc)
      from (
        select v.* from public.videos v
        where public.video_is_live(v) and (lower(v.caption) like '%' || pat || '%' or v.hashtags @> array[q])
        order by v.view_count desc, v.published_at desc
        limit n
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

-- What is popular right now. Null while the discover flag is off.
create or replace function public.discover_page()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.flag_on('discover', (select auth.uid())) then null
  else jsonb_build_object(
    'tags', public.trending_hashtags(12, 30),
    'creators', coalesce((
      select jsonb_agg(public.creator_card(p, (select auth.uid())) order by p.follower_count desc, p.username)
      from (
        select x.* from public.profiles x
        where x.banned_at is null and x.video_count > 0
        order by x.follower_count desc, x.username
        limit 10
      ) p
    ), '[]'::jsonb),
    'clips', coalesce((
      select jsonb_agg(public.video_card(x.vid, (select auth.uid())) order by x.recent desc, (x.vid).published_at desc)
      from (
        select v as vid, coalesce((
          select sum(w.views) from public.video_views w where w.video_id = v.id and w.day > current_date - 7
        ), 0) as recent
        from public.videos v
        where public.video_is_live(v)
        order by recent desc, v.published_at desc
        limit 18
      ) x
    ), '[]'::jsonb)
  ) end;
$$;

revoke execute on function public.like_escape(text) from public, anon, authenticated;
revoke execute on function public.video_is_live(public.videos) from public, anon, authenticated;
revoke execute on function public.creator_card(public.profiles, uuid) from public, anon, authenticated;
revoke execute on function public.hashtag_page(text, int, timestamptz) from public;
revoke execute on function public.trending_hashtags(int, int) from public, anon, authenticated;
revoke execute on function public.search_all(text, int) from public;
revoke execute on function public.discover_page() from public;
grant execute on function public.hashtag_page(text, int, timestamptz) to anon, authenticated;
grant execute on function public.search_all(text, int) to anon, authenticated;
grant execute on function public.discover_page() to anon, authenticated;

update public.feature_flags set description = 'A page of clips per hashtag at /tag/<name>, and hashtags on a clip become links.'
 where key = 'hashtags' and description like '%later session%';
update public.feature_flags set description = 'Search for people, hashtags and clips at /search.'
 where key = 'search' and description like '%later session%';

insert into public.feature_flags (key, label, description, mode)
values
  ('discover', 'Discover', 'Popular hashtags, creators and clips on the /search page before you type. Needs Search.', 'off')
on conflict (key) do nothing;

-- ===== 014_follow_lists.sql =====
-- 014_follow_lists.sql
-- Who follows a creator, and who they follow: the two lists behind the
-- counts on a profile. Newest first, banned accounts left out.
--
-- Run after 013_discover.sql. Safe to run more than once.

-- p_kind: 'followers' or 'following'. Pass the "at" of the last row you have
-- to get the next page. Null while the follow_lists flag is off, or when
-- there is no such account.
create or replace function public.follow_list(
  p_username text,
  p_kind text,
  p_limit int default 30,
  p_before timestamptz default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.flag_on('follow_lists', (select auth.uid())) or p_kind not in ('followers', 'following') then null
  else (
    select jsonb_build_object(
      'username', owner.username,
      'kind', p_kind,
      'people', coalesce((
        select jsonb_agg(public.creator_card(page.person, (select auth.uid())) || jsonb_build_object('at', page.at) order by page.at desc)
        from (
          select p as person, f.created_at as at
          from public.follows f
          join public.profiles p on p.id = case when p_kind = 'followers' then f.follower_id else f.followee_id end
          where (case when p_kind = 'followers' then f.followee_id else f.follower_id end) = owner.id
            and p.banned_at is null
            and (p_before is null or f.created_at < p_before)
          order by f.created_at desc
          limit least(greatest(coalesce(p_limit, 30), 1), 60)
        ) page
      ), '[]'::jsonb)
    )
    from public.profiles owner
    where lower(owner.username) = lower(p_username) and owner.banned_at is null
  ) end;
$$;

revoke execute on function public.follow_list(text, text, int, timestamptz) from public;
grant execute on function public.follow_list(text, text, int, timestamptz) to anon, authenticated;

insert into public.feature_flags (key, label, description, mode)
values
  ('follow_lists', 'Follower lists', 'Tapping Followers or Following on a profile opens the list of accounts. Needs Follows.', 'off')
on conflict (key) do nothing;

-- ===== 015_comment_threads.sql =====
-- 015_comment_threads.sql
-- Replies to comments, and likes on comments.
--
-- - A reply hangs under a top level comment (one level: a reply to a reply
--   lands under the same top level comment).
-- - comment_likes is private, like likes on clips; toggle_comment_like() is
--   the only way to write it.
-- - add_comment() takes the comment being answered. video_comments() now
--   lists top level comments with their like and reply counts;
--   comment_replies() lists the replies of one, oldest first.
-- - Replies and comment likes need the comment_threads flag. Plain comments
--   keep working without it.
--
-- Run after 014_follow_lists.sql. Safe to run more than once.

alter table public.comments add column if not exists parent_id uuid references public.comments (id) on delete cascade;
alter table public.comments add column if not exists like_count int not null default 0;
alter table public.comments add column if not exists reply_count int not null default 0;

create index if not exists comments_parent_idx on public.comments (parent_id, created_at) where parent_id is not null;

revoke all on public.comments from anon, authenticated;
grant select (id, video_id, author_id, body, created_at, parent_id, like_count, reply_count) on public.comments to anon, authenticated;

create table if not exists public.comment_likes (
  comment_id uuid not null references public.comments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table public.comment_likes enable row level security;

drop policy if exists "people read their own comment likes" on public.comment_likes;
create policy "people read their own comment likes"
  on public.comment_likes
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.comment_likes from anon, authenticated;
grant select on public.comment_likes to authenticated;

create or replace function public.comment_likes_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.comments c
     set like_count = greatest(c.like_count + case when tg_op = 'INSERT' then 1 else -1 end, 0)
   where c.id = coalesce(new.comment_id, old.comment_id);
  return null;
end;
$$;

drop trigger if exists comment_likes_count on public.comment_likes;
create trigger comment_likes_count
  after insert or delete on public.comment_likes
  for each row execute function public.comment_likes_count();

-- comments.reply_count: the replies a visitor can read.
create or replace function public.comment_replies_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  was_counted boolean := tg_op <> 'INSERT' and old.parent_id is not null and old.removed_at is null;
  is_counted boolean := tg_op <> 'DELETE' and new.parent_id is not null and new.removed_at is null;
begin
  if was_counted and not is_counted then
    update public.comments c set reply_count = greatest(c.reply_count - 1, 0) where c.id = old.parent_id;
  elsif is_counted and not was_counted then
    update public.comments c set reply_count = c.reply_count + 1 where c.id = new.parent_id;
  end if;
  return null;
end;
$$;

drop trigger if exists comment_replies_count on public.comments;
create trigger comment_replies_count
  after insert or update of removed_at or delete on public.comments
  for each row execute function public.comment_replies_count();

-- One comment as the app shows it.
create or replace function public.comment_card(c public.comments, viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'parent_id', c.parent_id,
    'body', c.body,
    'created_at', c.created_at,
    'like_count', c.like_count,
    'reply_count', c.reply_count,
    'liked', viewer is not null
      and exists (select 1 from public.comment_likes l where l.comment_id = c.id and l.user_id = viewer),
    'author', jsonb_build_object(
      'id', p.id,
      'username', p.username,
      'display_name', p.display_name,
      'avatar_url', p.avatar_url,
      'verified', p.verified
    ),
    'mine', viewer is not null and c.author_id = viewer
  )
  from public.profiles p
  where p.id = c.author_id;
$$;

-- The old two argument add_comment (006) would make a call with two
-- arguments ambiguous next to the new one.
drop function if exists public.add_comment(uuid, text);

-- Posts a comment, or a reply when p_parent is a comment on the same clip.
-- Errors: not_signed_in, comments_off, replies_off, banned, not_onboarded,
--   not_found, comment_invalid, slow_down
create or replace function public.add_comment(p_video uuid, p_body text, p_parent uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  me_profile public.profiles;
  clean text := trim(both from regexp_replace(coalesce(p_body, ''), '[[:cntrl:]]+', ' ', 'g'));
  parent public.comments;
  new_row public.comments;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not public.flag_on('comments', me)
     or coalesce(public.site_setting('comments_enabled'), 'true'::jsonb) = 'false'::jsonb then
    raise exception 'comments_off' using errcode = 'P0001';
  end if;
  select * into me_profile from public.profiles p where p.id = me;
  if me_profile.banned_at is not null then
    raise exception 'banned' using errcode = 'P0001';
  end if;
  if me_profile.id is null or not me_profile.onboarded then
    raise exception 'not_onboarded' using errcode = 'P0001';
  end if;
  if not public.video_is_visible(p_video) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if p_parent is not null then
    if not public.flag_on('comment_threads', me) then
      raise exception 'replies_off' using errcode = 'P0001';
    end if;
    select * into parent from public.comments c
     where c.id = p_parent and c.video_id = p_video and c.removed_at is null;
    if parent.id is null then
      raise exception 'not_found' using errcode = 'P0001';
    end if;
  end if;
  if char_length(clean) not between 1 and 500 then
    raise exception 'comment_invalid' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('add_comment:' || me::text, 0));
  if (select count(*) from public.comments c
       where c.author_id = me and c.created_at > now() - interval '1 minute') >= 6 then
    raise exception 'slow_down' using errcode = 'P0001';
  end if;

  insert into public.comments (video_id, author_id, body, parent_id)
  -- One level: a reply to a reply goes under the same top level comment.
  values (p_video, me, clean, coalesce(parent.parent_id, parent.id))
  returning * into new_row;

  return public.comment_card(new_row, me);
end;
$$;

-- Likes a comment or takes the like back. Answers { liked, like_count }.
-- Errors: not_signed_in, replies_off, banned, not_found
create or replace function public.toggle_comment_like(p_comment uuid, p_on boolean default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  has boolean;
  want boolean;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not public.flag_on('comment_threads', me) then
    raise exception 'replies_off' using errcode = 'P0001';
  end if;
  if public.is_banned(me) then
    raise exception 'banned' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.comments c
                  where c.id = p_comment and c.removed_at is null and public.video_is_visible(c.video_id)) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  has := exists (select 1 from public.comment_likes l where l.comment_id = p_comment and l.user_id = me);
  want := coalesce(p_on, not has);
  if want and not has then
    insert into public.comment_likes (comment_id, user_id) values (p_comment, me) on conflict do nothing;
  elsif has and not want then
    delete from public.comment_likes l where l.comment_id = p_comment and l.user_id = me;
  end if;
  return jsonb_build_object('liked', want, 'like_count', (select c.like_count from public.comments c where c.id = p_comment));
end;
$$;

-- One page of a clip's top level comments, newest first.
create or replace function public.video_comments(
  p_video uuid,
  p_limit int default 30,
  p_before timestamptz default null,
  p_before_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.comment_card(c, (select auth.uid())) order by c.created_at desc, c.id desc), '[]'::jsonb)
  from (
    select x.*
    from public.comments x
    join public.profiles p on p.id = x.author_id
    where x.video_id = p_video
      and x.parent_id is null
      and x.removed_at is null
      and p.banned_at is null
      and public.video_is_visible(p_video)
      and public.flag_on('comments', (select auth.uid()))
      and (p_before is null or (x.created_at, x.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by x.created_at desc, x.id desc
    limit least(greatest(coalesce(p_limit, 30), 1), 50)
  ) c;
$$;

-- The replies under one comment, oldest first.
create or replace function public.comment_replies(p_comment uuid, p_limit int default 50)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.comment_card(c, (select auth.uid())) order by c.created_at, c.id), '[]'::jsonb)
  from (
    select x.*
    from public.comments x
    join public.profiles p on p.id = x.author_id
    where x.parent_id = p_comment
      and x.removed_at is null
      and p.banned_at is null
      and public.video_is_visible(x.video_id)
      and public.flag_on('comments', (select auth.uid()))
    order by x.created_at, x.id
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  ) c;
$$;

revoke execute on function public.comment_likes_count() from public, anon, authenticated;
revoke execute on function public.comment_replies_count() from public, anon, authenticated;
revoke execute on function public.comment_card(public.comments, uuid) from public, anon, authenticated;
revoke execute on function public.add_comment(uuid, text, uuid) from public, anon;
revoke execute on function public.toggle_comment_like(uuid, boolean) from public, anon;
revoke execute on function public.comment_replies(uuid, int) from public;
grant execute on function public.add_comment(uuid, text, uuid) to authenticated;
grant execute on function public.toggle_comment_like(uuid, boolean) to authenticated;
grant execute on function public.comment_replies(uuid, int) to anon, authenticated;

insert into public.feature_flags (key, label, description, mode)
values
  ('comment_threads', 'Comment replies and likes', 'Reply to a comment and like comments. Needs Comments.', 'off')
on conflict (key) do nothing;

-- ===== 016_inbox.sql =====
-- 016_inbox.sql
-- The activity inbox: who liked, commented, replied or followed.
--
-- - notifications has one row per thing that happened to you. Triggers on
--   likes, follows, comments and comment_likes write it; nothing else can.
--   The same person liking the same clip twice makes one row, not two.
-- - You never get a notification for your own action, or from a banned account.
-- - inbox_page() lists yours, newest first; inbox_unread() counts the unread
--   ones for the dot in the navigation; inbox_mark_read() clears it.
-- - Nothing is written or shown while the inbox flag is off for the receiver.
--
-- Run after 015_comment_threads.sql. Safe to run more than once.

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  video_id uuid references public.videos (id) on delete cascade,
  comment_id uuid references public.comments (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_kind_valid check (kind in ('like', 'comment', 'reply', 'comment_like', 'follow')),
  constraint notifications_not_self check (user_id <> actor_id)
);

create index if not exists notifications_user_idx on public.notifications (user_id, id desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;
-- One row per person, kind and thing.
create unique index if not exists notifications_once on public.notifications (
  user_id, actor_id, kind,
  coalesce(video_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(comment_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

alter table public.notifications enable row level security;
-- Read through inbox_page(). No policies, no grants.
revoke all on public.notifications from anon, authenticated;

create or replace function public.notify(receiver uuid, actor uuid, kind text, video uuid, comment uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if receiver is null or actor is null or receiver = actor then
    return;
  end if;
  if not public.flag_on('inbox', receiver) or public.is_banned(actor) then
    return;
  end if;
  insert into public.notifications (user_id, actor_id, kind, video_id, comment_id)
  values (receiver, actor, kind, video, comment)
  on conflict do nothing;
end;
$$;

create or replace function public.notify_on_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notify((select v.owner_id from public.videos v where v.id = new.video_id), new.user_id, 'like', new.video_id, null);
  return null;
end;
$$;

create or replace function public.notify_on_follow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notify(new.followee_id, new.follower_id, 'follow', null, null);
  return null;
end;
$$;

create or replace function public.notify_on_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.parent_id is not null then
    perform public.notify((select c.author_id from public.comments c where c.id = new.parent_id), new.author_id, 'reply', new.video_id, new.id);
  else
    perform public.notify((select v.owner_id from public.videos v where v.id = new.video_id), new.author_id, 'comment', new.video_id, new.id);
  end if;
  return null;
end;
$$;

create or replace function public.notify_on_comment_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.comments;
begin
  select * into c from public.comments x where x.id = new.comment_id;
  perform public.notify(c.author_id, new.user_id, 'comment_like', c.video_id, c.id);
  return null;
end;
$$;

drop trigger if exists likes_notify on public.likes;
create trigger likes_notify after insert on public.likes
  for each row execute function public.notify_on_like();
drop trigger if exists follows_notify on public.follows;
create trigger follows_notify after insert on public.follows
  for each row execute function public.notify_on_follow();
drop trigger if exists comments_notify on public.comments;
create trigger comments_notify after insert on public.comments
  for each row execute function public.notify_on_comment();
drop trigger if exists comment_likes_notify on public.comment_likes;
create trigger comment_likes_notify after insert on public.comment_likes
  for each row execute function public.notify_on_comment_like();

-- The caller's notifications, newest first. Pass the id of the last one you
-- have to get the next page. Things about clips or comments that are gone or
-- removed drop out.
create or replace function public.inbox_page(p_limit int default 40, p_before bigint default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row order by id desc), '[]'::jsonb)
  from (
    select n.id, jsonb_build_object(
      'id', n.id,
      'kind', n.kind,
      'created_at', n.created_at,
      'unread', n.read_at is null,
      'actor', jsonb_build_object(
        'id', a.id, 'username', a.username, 'display_name', a.display_name, 'avatar_url', a.avatar_url, 'verified', a.verified
      ),
      'video', case when v.id is null then null else jsonb_build_object('id', v.id, 'caption', v.caption, 'thumbnail_url', v.thumbnail_url) end,
      'comment', case when c.id is null then null else c.body end
    ) as row
    from public.notifications n
    join public.profiles a on a.id = n.actor_id
    left join public.videos v on v.id = n.video_id
    left join public.comments c on c.id = n.comment_id
    where n.user_id = (select auth.uid())
      and public.flag_on('inbox', (select auth.uid()))
      and a.banned_at is null
      and (n.video_id is null or (v.removed_at is null and v.status = 'ready'))
      and (n.comment_id is null or c.removed_at is null)
      and (p_before is null or n.id < p_before)
    order by n.id desc
    limit least(greatest(coalesce(p_limit, 40), 1), 100)
  ) page;
$$;

create or replace function public.inbox_unread()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.flag_on('inbox', (select auth.uid()))
    then (select count(*)::int from public.notifications n where n.user_id = (select auth.uid()) and n.read_at is null)
    else 0 end;
$$;

create or replace function public.inbox_mark_read()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.notifications n set read_at = now()
   where n.user_id = (select auth.uid()) and n.read_at is null;
$$;

revoke execute on function public.notify(uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.notify_on_like() from public, anon, authenticated;
revoke execute on function public.notify_on_follow() from public, anon, authenticated;
revoke execute on function public.notify_on_comment() from public, anon, authenticated;
revoke execute on function public.notify_on_comment_like() from public, anon, authenticated;
revoke execute on function public.inbox_page(int, bigint) from public, anon;
revoke execute on function public.inbox_unread() from public, anon;
revoke execute on function public.inbox_mark_read() from public, anon;
grant execute on function public.inbox_page(int, bigint) to authenticated;
grant execute on function public.inbox_unread() to authenticated;
grant execute on function public.inbox_mark_read() to authenticated;

insert into public.feature_flags (key, label, description, mode)
values
  ('inbox', 'Activity inbox', 'The Inbox page: who liked, commented, replied or followed, with a dot for what is new.', 'off')
on conflict (key) do nothing;

-- ===== 017_messages.sql =====
-- 017_messages.sql
-- Direct messages: text, and sending a clip to someone.
--
-- - messages is private. Nobody reads or writes it through the API; the
--   functions below only ever answer the caller's own conversations.
-- - send_message() checks the flag, the ban, that the other account exists,
--   and a limit of 30 messages a minute.
-- - dm_threads() lists the caller's conversations, newest first, with the
--   last message and how many are unread. dm_thread() answers one
--   conversation and marks what was received as read.
-- - For now anyone with an account can message anyone. "Who can message me"
--   and blocking are a later migration.
--
-- Run after 016_inbox.sql. Safe to run more than once.

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  receiver_id uuid not null references public.profiles (id) on delete cascade,
  body text not null default '',
  video_id uuid references public.videos (id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint messages_not_self check (sender_id <> receiver_id),
  constraint messages_body_length check (char_length(body) <= 1000)
);

create index if not exists messages_pair_idx on public.messages (least(sender_id, receiver_id), greatest(sender_id, receiver_id), id desc);
create index if not exists messages_unread_idx on public.messages (receiver_id) where read_at is null;
create index if not exists messages_sender_recent_idx on public.messages (sender_id, created_at desc);

alter table public.messages enable row level security;
revoke all on public.messages from anon, authenticated;

-- One message as the app shows it.
create or replace function public.message_card(m public.messages, viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id,
    'body', m.body,
    'created_at', m.created_at,
    'mine', m.sender_id = viewer,
    'read', m.read_at is not null,
    -- A clip that was sent along, if the viewer may still see it.
    'video', (
      select jsonb_build_object('id', v.id, 'caption', v.caption, 'thumbnail_url', v.thumbnail_url, 'username', p.username)
      from public.videos v join public.profiles p on p.id = v.owner_id
      where v.id = m.video_id and public.video_is_live(v)
    ),
    'had_video', m.video_id is not null
  );
$$;

-- Sends a message. Errors: not_signed_in, messages_off, banned,
--   not_onboarded, self, not_found, message_invalid, slow_down
create or replace function public.send_message(p_to uuid, p_body text default '', p_video uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  me_profile public.profiles;
  clean text := trim(both from regexp_replace(coalesce(p_body, ''), '[[:cntrl:]]+', ' ', 'g'));
  new_row public.messages;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not public.flag_on('messages', me) then
    raise exception 'messages_off' using errcode = 'P0001';
  end if;
  select * into me_profile from public.profiles p where p.id = me;
  if me_profile.banned_at is not null then
    raise exception 'banned' using errcode = 'P0001';
  end if;
  if me_profile.id is null or not me_profile.onboarded then
    raise exception 'not_onboarded' using errcode = 'P0001';
  end if;
  if p_to = me then
    raise exception 'self' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_to and p.banned_at is null) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if p_video is not null and not public.video_is_visible(p_video) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if char_length(clean) > 1000 or (clean = '' and p_video is null) then
    raise exception 'message_invalid' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('send_message:' || me::text, 0));
  if (select count(*) from public.messages m
       where m.sender_id = me and m.created_at > now() - interval '1 minute') >= 30 then
    raise exception 'slow_down' using errcode = 'P0001';
  end if;

  insert into public.messages (sender_id, receiver_id, body, video_id)
  values (me, p_to, clean, p_video)
  returning * into new_row;
  return public.message_card(new_row, me);
end;
$$;

-- The caller's conversations, newest first.
create or replace function public.dm_threads(p_limit int default 40)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.flag_on('messages', (select auth.uid())) then '[]'::jsonb
  else coalesce((
    select jsonb_agg(jsonb_build_object(
      'with', public.creator_card(p, (select auth.uid())),
      'last', public.message_card(t.last, (select auth.uid())),
      'unread', t.unread
    ) order by (t.last).id desc)
    from (
      select
        case when m.sender_id = (select auth.uid()) then m.receiver_id else m.sender_id end as other,
        (array_agg(m order by m.id desc))[1] as last,
        count(*) filter (where m.receiver_id = (select auth.uid()) and m.read_at is null) as unread
      from public.messages m
      where (select auth.uid()) in (m.sender_id, m.receiver_id)
      group by 1
      order by max(m.id) desc
      limit least(greatest(coalesce(p_limit, 40), 1), 100)
    ) t
    join public.profiles p on p.id = t.other and p.banned_at is null
  ), '[]'::jsonb) end;
$$;

-- One conversation, oldest message first, and the person it is with. What
-- the caller received in it is marked read. Null: no such account, or the
-- flag is off. Pass the id of the oldest message you have for earlier ones.
create or replace function public.dm_thread(p_username text, p_limit int default 60, p_before bigint default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  other public.profiles;
  out jsonb;
begin
  if me is null or not public.flag_on('messages', me) then
    return null;
  end if;
  select * into other from public.profiles p where lower(p.username) = lower(p_username) and p.banned_at is null;
  if other.id is null or other.id = me then
    return null;
  end if;

  select jsonb_build_object(
    'with', public.creator_card(other, me),
    'messages', coalesce((
      select jsonb_agg(public.message_card(m, me) order by m.id)
      from (
        select x.* from public.messages x
        where ((x.sender_id = me and x.receiver_id = other.id) or (x.sender_id = other.id and x.receiver_id = me))
          and (p_before is null or x.id < p_before)
        order by x.id desc
        limit least(greatest(coalesce(p_limit, 60), 1), 100)
      ) m
    ), '[]'::jsonb)
  ) into out;

  update public.messages m set read_at = now()
   where m.receiver_id = me and m.sender_id = other.id and m.read_at is null;
  return out;
end;
$$;

create or replace function public.dm_unread()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.flag_on('messages', (select auth.uid()))
    then (select count(*)::int from public.messages m where m.receiver_id = (select auth.uid()) and m.read_at is null)
    else 0 end;
$$;

revoke execute on function public.message_card(public.messages, uuid) from public, anon, authenticated;
revoke execute on function public.send_message(uuid, text, uuid) from public, anon;
revoke execute on function public.dm_threads(int) from public, anon;
revoke execute on function public.dm_thread(text, int, bigint) from public, anon;
revoke execute on function public.dm_unread() from public, anon;
grant execute on function public.send_message(uuid, text, uuid) to authenticated;
grant execute on function public.dm_threads(int) to authenticated;
grant execute on function public.dm_thread(text, int, bigint) to authenticated;
grant execute on function public.dm_unread() to authenticated;

insert into public.feature_flags (key, label, description, mode)
values
  ('messages', 'Messages', 'Direct messages between accounts: text, and sending a clip to someone from the share sheet.', 'off')
on conflict (key) do nothing;

