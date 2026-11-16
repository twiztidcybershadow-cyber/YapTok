-- 008_moderation.sql
-- Moderation basics: reports from people, and what an admin can do about them.
--
-- - report_content() files a report on a clip or a comment. One open report
--   per person and target; ten reports per person per hour.
-- - Admins remove and restore clips and comments, ban and unban accounts,
--   mark accounts verified or invited, and close reports.
-- - Every one of those starts with require_admin() and ends with a row in
--   admin_log. There is no other way to do them: the tables have no write
--   policies.
-- - A banned account cannot upload, like, follow, comment or report (each
--   function checks), its clips and comments drop out of every list, and
--   proxy.ts signs it out on its next page.
--
-- Run after 007_feed.sql. Safe to run more than once.

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  target_type text not null,
  video_id uuid references public.videos (id) on delete cascade,
  comment_id uuid references public.comments (id) on delete cascade,
  reason text not null,
  note text not null default '',
  status text not null default 'open',
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint reports_target_type_valid check (target_type in ('video', 'comment')),
  constraint reports_target_set check (
    (target_type = 'video' and video_id is not null and comment_id is null)
    or (target_type = 'comment' and comment_id is not null)
  ),
  constraint reports_reason_valid check (
    reason in ('spam', 'nudity', 'violence', 'harassment', 'hate', 'dangerous', 'minor_safety', 'copyright', 'other')
  ),
  constraint reports_note_length check (char_length(note) <= 500),
  constraint reports_status_valid check (status in ('open', 'actioned', 'dismissed'))
);

create index if not exists reports_open_idx on public.reports (created_at desc) where status = 'open';
create index if not exists reports_reporter_idx on public.reports (reporter_id, created_at desc);
create unique index if not exists reports_one_open_video on public.reports (reporter_id, video_id)
  where status = 'open' and target_type = 'video';
create unique index if not exists reports_one_open_comment on public.reports (reporter_id, comment_id)
  where status = 'open' and target_type = 'comment';

alter table public.reports enable row level security;
-- Read through admin_reports() (009). No policies, no grants.
revoke all on public.reports from anon, authenticated;

-- Files a report. Answers 'reported', or 'already' when this person has an
-- open report on the same thing.
-- Errors: not_signed_in, reports_off, banned, bad_target, bad_reason,
--   note_too_long, not_found, slow_down
create or replace function public.report_content(
  p_type text,
  p_id uuid,
  p_reason text,
  p_note text default ''
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  clean_note text := trim(both from coalesce(p_note, ''));
  vid uuid;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not public.flag_on('reports', me) then
    raise exception 'reports_off' using errcode = 'P0001';
  end if;
  if public.is_banned(me) then
    raise exception 'banned' using errcode = 'P0001';
  end if;
  if p_type is null or p_type not in ('video', 'comment') then
    raise exception 'bad_target' using errcode = 'P0001';
  end if;
  if p_reason is null or p_reason not in
     ('spam', 'nudity', 'violence', 'harassment', 'hate', 'dangerous', 'minor_safety', 'copyright', 'other') then
    raise exception 'bad_reason' using errcode = 'P0001';
  end if;
  if char_length(clean_note) > 500 then
    raise exception 'note_too_long' using errcode = 'P0001';
  end if;

  if p_type = 'video' then
    vid := p_id;
  else
    select c.video_id into vid from public.comments c where c.id = p_id and c.removed_at is null;
  end if;
  if vid is null or not public.video_is_visible(vid) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('report:' || me::text, 0));
  if (select count(*) from public.reports r
       where r.reporter_id = me and r.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'slow_down' using errcode = 'P0001';
  end if;

  begin
    insert into public.reports (reporter_id, target_type, video_id, comment_id, reason, note)
    values (me, p_type, vid, case when p_type = 'comment' then p_id end, p_reason, clean_note);
  exception when unique_violation then
    return 'already';
  end;
  return 'reported';
end;
$$;

-- Admin actions ---------------------------------------------------------------------

-- Closes every open report on a clip or comment once an admin acted on it.
create or replace function public.reports_close_for(actor uuid, p_type text, p_id uuid, p_status text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.reports r
     set status = p_status, resolved_by = actor, resolved_at = now()
   where r.status = 'open'
     and r.target_type = p_type
     and ((p_type = 'video' and r.video_id = p_id) or (p_type = 'comment' and r.comment_id = p_id));
$$;

-- Hides a clip from everyone but its owner and admins. Open reports on it
-- are closed as actioned. Errors: not_signed_in, not_admin, not_found
create or replace function public.admin_remove_video(p_video uuid, p_reason text default '')
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_admin();
  clean text := left(trim(both from coalesce(p_reason, '')), 200);
begin
  update public.videos v
     set removed_at = coalesce(v.removed_at, now()), removed_by = me, removed_reason = clean
   where v.id = p_video;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform public.reports_close_for(me, 'video', p_video, 'actioned');
  perform public.admin_log_add(me, 'video.remove', 'video', p_video::text, jsonb_build_object('reason', clean));
end;
$$;

create or replace function public.admin_restore_video(p_video uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_admin();
begin
  update public.videos v
     set removed_at = null, removed_by = null, removed_reason = null
   where v.id = p_video;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform public.admin_log_add(me, 'video.restore', 'video', p_video::text);
end;
$$;

create or replace function public.admin_remove_comment(p_comment uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_admin();
begin
  update public.comments c
     set removed_at = coalesce(c.removed_at, now()), removed_by = me
   where c.id = p_comment;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform public.reports_close_for(me, 'comment', p_comment, 'actioned');
  perform public.admin_log_add(me, 'comment.remove', 'comment', p_comment::text);
end;
$$;

create or replace function public.admin_restore_comment(p_comment uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_admin();
begin
  update public.comments c set removed_at = null, removed_by = null where c.id = p_comment;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform public.admin_log_add(me, 'comment.restore', 'comment', p_comment::text);
end;
$$;

-- Closes one report without touching what it is about.
-- Errors: not_signed_in, not_admin, not_found
create or replace function public.admin_dismiss_report(p_report uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_admin();
begin
  update public.reports r
     set status = 'dismissed', resolved_by = me, resolved_at = now()
   where r.id = p_report and r.status = 'open';
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform public.admin_log_add(me, 'report.dismiss', 'report', p_report::text);
end;
$$;

-- Bans an account. Errors: not_signed_in, not_admin, not_found, self,
--   is_admin (take them out of the admins table first)
create or replace function public.admin_ban(p_user uuid, p_reason text default '')
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_admin();
  clean text := left(trim(both from coalesce(p_reason, '')), 200);
begin
  if p_user = me then
    raise exception 'self' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.admins a where a.user_id = p_user) then
    raise exception 'is_admin' using errcode = 'P0001';
  end if;
  update public.profiles p
     set banned_at = coalesce(p.banned_at, now()), banned_by = me, banned_reason = clean
   where p.id = p_user;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform public.admin_log_add(me, 'account.ban', 'account', p_user::text, jsonb_build_object('reason', clean));
end;
$$;

create or replace function public.admin_unban(p_user uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_admin();
begin
  update public.profiles p
     set banned_at = null, banned_by = null, banned_reason = null
   where p.id = p_user;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform public.admin_log_add(me, 'account.unban', 'account', p_user::text);
end;
$$;

-- Sets the verified or the invited mark on an account. They decide who may
-- upload when the upload_who setting is "verified" or "invite".
-- Errors: not_signed_in, not_admin, bad_mark, not_found
create or replace function public.admin_set_mark(p_user uuid, p_mark text, p_on boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_admin();
begin
  if p_mark is null or p_mark not in ('verified', 'invited') or p_on is null then
    raise exception 'bad_mark' using errcode = 'P0001';
  end if;
  if p_mark = 'verified' then
    update public.profiles p set verified = p_on where p.id = p_user;
  else
    update public.profiles p set invited = p_on where p.id = p_user;
  end if;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform public.admin_log_add(me, 'account.' || p_mark, 'account', p_user::text, jsonb_build_object('on', p_on));
end;
$$;

-- Who may call what ----------------------------------------------------------------

revoke execute on function public.reports_close_for(uuid, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.report_content(text, uuid, text, text) from public, anon;
revoke execute on function public.admin_remove_video(uuid, text) from public, anon;
revoke execute on function public.admin_restore_video(uuid) from public, anon;
revoke execute on function public.admin_remove_comment(uuid) from public, anon;
revoke execute on function public.admin_restore_comment(uuid) from public, anon;
revoke execute on function public.admin_dismiss_report(uuid) from public, anon;
revoke execute on function public.admin_ban(uuid, text) from public, anon;
revoke execute on function public.admin_unban(uuid) from public, anon;
revoke execute on function public.admin_set_mark(uuid, text, boolean) from public, anon;
grant execute on function public.report_content(text, uuid, text, text) to authenticated;
grant execute on function public.admin_remove_video(uuid, text) to authenticated;
grant execute on function public.admin_restore_video(uuid) to authenticated;
grant execute on function public.admin_remove_comment(uuid) to authenticated;
grant execute on function public.admin_restore_comment(uuid) to authenticated;
grant execute on function public.admin_dismiss_report(uuid) to authenticated;
grant execute on function public.admin_ban(uuid, text) to authenticated;
grant execute on function public.admin_unban(uuid) to authenticated;
grant execute on function public.admin_set_mark(uuid, text, boolean) to authenticated;

insert into public.feature_flags (key, label, description, mode)
values
  ('reports', 'Reports', 'The report button on clips and comments. Reports land in the queue at /admin/reports.', 'off')
on conflict (key) do nothing;
