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
