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
