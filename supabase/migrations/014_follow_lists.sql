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
