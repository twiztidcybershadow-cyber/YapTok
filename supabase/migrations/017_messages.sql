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
