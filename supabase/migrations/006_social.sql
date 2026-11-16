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
