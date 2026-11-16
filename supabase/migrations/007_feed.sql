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
