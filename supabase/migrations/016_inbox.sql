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
