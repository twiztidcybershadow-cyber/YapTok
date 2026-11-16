-- 012_saves.sql
-- Saving clips for later, and the owner's Liked and Saved lists.
--
-- - saves is private: you can read your own, nobody else can.
-- - toggle_save() is the only way to write it, like toggle_like() in 006.
-- - Every clip card now also says whether the person asking saved it, and how
--   many people did (video_card is replaced with the two extra fields).
-- - my_clips('liked' | 'saved') lists the caller's own liked or saved clips,
--   most recent first, for the two extra tabs on their profile. Clips that
--   were removed, made private or belong to a banned creator drop out.
--
-- Run after 011_following.sql. Safe to run more than once.

alter table public.videos add column if not exists save_count int not null default 0;

create table if not exists public.saves (
  video_id uuid not null references public.videos (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (video_id, user_id)
);

create index if not exists saves_user_idx on public.saves (user_id, created_at desc);

alter table public.saves enable row level security;

drop policy if exists "people read their own saves" on public.saves;
create policy "people read their own saves"
  on public.saves
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.saves from anon, authenticated;
grant select on public.saves to authenticated;

create or replace function public.saves_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.videos v
     set save_count = greatest(v.save_count + case when tg_op = 'INSERT' then 1 else -1 end, 0)
   where v.id = coalesce(new.video_id, old.video_id);
  return null;
end;
$$;

drop trigger if exists saves_count on public.saves;
create trigger saves_count
  after insert or delete on public.saves
  for each row execute function public.saves_count();

-- Saves a clip or takes it out again. Answers { saved, save_count }.
-- Errors: not_signed_in, saves_off, banned, not_found
create or replace function public.toggle_save(p_video uuid, p_on boolean default null)
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
  if not public.flag_on('saves', me) then
    raise exception 'saves_off' using errcode = 'P0001';
  end if;
  if public.is_banned(me) then
    raise exception 'banned' using errcode = 'P0001';
  end if;
  if not public.video_is_visible(p_video) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  has := exists (select 1 from public.saves s where s.video_id = p_video and s.user_id = me);
  want := coalesce(p_on, not has);
  if want and not has then
    insert into public.saves (video_id, user_id) values (p_video, me) on conflict do nothing;
  elsif has and not want then
    delete from public.saves s where s.video_id = p_video and s.user_id = me;
  end if;

  return jsonb_build_object(
    'saved', want,
    'save_count', (select v.save_count from public.videos v where v.id = p_video)
  );
end;
$$;

-- One clip as the app shows it, now with saved and save_count.
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
    'save_count', v.save_count,
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
    'saved', viewer is not null
      and exists (select 1 from public.saves s where s.video_id = v.id and s.user_id = viewer),
    'mine', viewer is not null and v.owner_id = viewer
  )
  from public.profiles p
  where p.id = v.owner_id;
$$;

revoke execute on function public.video_card(public.videos, uuid) from public, anon, authenticated;

-- The caller's own liked or saved clips, most recent first. Pass the "at" of
-- the last one you have to get the next page. Each row is a clip card plus
-- "at": when it was liked or saved.
create or replace function public.my_clips(p_kind text, p_limit int default 24, p_before timestamptz default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.video_card(v, (select auth.uid())) || jsonb_build_object('at', picked.at) order by picked.at desc), '[]'::jsonb)
  from (
    select l.video_id, l.created_at as at from public.likes l
     where p_kind = 'liked' and l.user_id = (select auth.uid()) and public.flag_on('likes', (select auth.uid()))
    union all
    select s.video_id, s.created_at from public.saves s
     where p_kind = 'saved' and s.user_id = (select auth.uid()) and public.flag_on('saves', (select auth.uid()))
  ) picked
  join public.videos v on v.id = picked.video_id
  join public.profiles p on p.id = v.owner_id
  where v.visibility = 'public' and v.status = 'ready' and v.removed_at is null and p.banned_at is null
    and (p_before is null or picked.at < p_before)
    and picked.video_id in (
      select x.video_id from (
        select l.video_id, l.created_at as at from public.likes l where p_kind = 'liked' and l.user_id = (select auth.uid())
        union all
        select s.video_id, s.created_at from public.saves s where p_kind = 'saved' and s.user_id = (select auth.uid())
      ) x
      where p_before is null or x.at < p_before
      order by x.at desc
      limit least(greatest(coalesce(p_limit, 24), 1), 60)
    );
$$;

revoke execute on function public.saves_count() from public, anon, authenticated;
revoke execute on function public.toggle_save(uuid, boolean) from public, anon;
revoke execute on function public.my_clips(text, int, timestamptz) from public, anon;
grant execute on function public.toggle_save(uuid, boolean) to authenticated;
grant execute on function public.my_clips(text, int, timestamptz) to authenticated;

insert into public.feature_flags (key, label, description, mode)
values
  ('saves', 'Saves', 'The bookmark on every clip, and the Liked and Saved tabs on your own profile.', 'off')
on conflict (key) do nothing;
