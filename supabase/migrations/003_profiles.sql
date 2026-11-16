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
