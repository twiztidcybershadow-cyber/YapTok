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
