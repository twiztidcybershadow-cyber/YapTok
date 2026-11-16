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
