-- 009_admin_panel.sql
-- What the pages under /admin read. Each function starts with
-- require_admin(), so the lists are empty-handed for everyone else: the
-- tables behind them (admin_log, reports, the ban columns) have no read
-- access through the API at all.
--
-- Run after 008_moderation.sql. Safe to run more than once.

-- A short "who" for the lists: { id, username } or null.
create or replace function public.admin_who(uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'username', p.username)
  from public.profiles p where p.id = uid;
$$;

-- Every flag, with who changed it last and when.
create or replace function public.admin_flags()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_admin();
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'key', f.key,
      'label', f.label,
      'description', f.description,
      'mode', f.mode,
      'testers', cardinality(f.users),
      'me_listed', me = any (f.users),
      'updated_at', f.updated_at,
      'updated_by', public.admin_who(f.updated_by)
    ) order by f.key), '[]'::jsonb)
    from public.feature_flags f
  );
end;
$$;

-- Every site setting, with who changed it last and when.
create or replace function public.admin_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'key', s.key,
      'label', s.label,
      'description', s.description,
      'kind', s.kind,
      'value', s.value,
      'options', s.options,
      'min', s.min_value,
      'max', s.max_value,
      'updated_at', s.updated_at,
      'updated_by', public.admin_who(s.updated_by)
    ) order by s.sort, s.key), '[]'::jsonb)
    from public.site_settings s
  );
end;
$$;

-- The reports queue: 'open' (oldest first) or 'closed' (newest first).
create or replace function public.admin_reports(p_status text default 'open', p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return (
    select coalesce(jsonb_agg(row), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id', r.id,
        'target_type', r.target_type,
        'reason', r.reason,
        'note', r.note,
        'status', r.status,
        'created_at', r.created_at,
        'resolved_at', r.resolved_at,
        'reporter', public.admin_who(r.reporter_id),
        'resolved_by', public.admin_who(r.resolved_by),
        'video', jsonb_build_object(
          'id', v.id,
          'caption', v.caption,
          'thumbnail_url', v.thumbnail_url,
          'removed', v.removed_at is not null,
          'owner', public.admin_who(v.owner_id)
        ),
        'comment', case when c.id is null then null else jsonb_build_object(
          'id', c.id,
          'body', c.body,
          'removed', c.removed_at is not null,
          'author', public.admin_who(c.author_id)
        ) end
      ) as row
      from public.reports r
      join public.videos v on v.id = r.video_id
      left join public.comments c on c.id = r.comment_id
      where (p_status = 'open' and r.status = 'open')
         or (p_status <> 'open' and r.status <> 'open')
      order by
        case when p_status = 'open' then r.created_at end asc,
        case when p_status <> 'open' then r.resolved_at end desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) page
  );
end;
$$;

-- Clips for /admin/videos, newest first. p_state: 'all', 'live', 'removed',
-- 'processing' or 'failed'. p_q matches the caption, a hashtag, the creator's
-- username or the clip id.
create or replace function public.admin_videos(p_q text default '', p_state text default 'all', p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q text := lower(trim(both from coalesce(p_q, '')));
begin
  perform public.require_admin();
  return (
    select coalesce(jsonb_agg(row), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id', v.id,
        'caption', v.caption,
        'hashtags', to_jsonb(v.hashtags),
        'status', v.status,
        'visibility', v.visibility,
        'thumbnail_url', v.thumbnail_url,
        'duration_s', v.duration_s,
        'error', v.error,
        'view_count', v.view_count,
        'like_count', v.like_count,
        'comment_count', v.comment_count,
        'created_at', v.created_at,
        'removed', v.removed_at is not null,
        'removed_at', v.removed_at,
        'removed_reason', v.removed_reason,
        'owner', public.admin_who(v.owner_id),
        'open_reports', (select count(*) from public.reports r where r.video_id = v.id and r.status = 'open')
      ) as row
      from public.videos v
      join public.profiles p on p.id = v.owner_id
      where (
          p_state = 'all'
          or (p_state = 'live' and v.status = 'ready' and v.removed_at is null and v.visibility = 'public')
          or (p_state = 'removed' and v.removed_at is not null)
          or (p_state = 'processing' and v.status in ('uploading', 'uploaded', 'processing'))
          or (p_state = 'failed' and v.status = 'failed')
        )
        and (
          q = ''
          or position(q in lower(v.caption)) > 0
          or v.hashtags @> array[regexp_replace(q, '^#', '')]
          or lower(p.username) = regexp_replace(q, '^@', '')
          or v.id::text = q
        )
      order by v.created_at desc, v.id desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) page
  );
end;
$$;

-- Accounts for /admin/accounts, newest first. p_q matches the start of the
-- username or the display name, or the account id.
create or replace function public.admin_accounts(p_q text default '', p_state text default 'all', p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q text := lower(regexp_replace(trim(both from coalesce(p_q, '')), '^@', ''));
begin
  perform public.require_admin();
  return (
    select coalesce(jsonb_agg(row), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id', p.id,
        'username', p.username,
        'display_name', p.display_name,
        'avatar_url', p.avatar_url,
        'verified', p.verified,
        'invited', p.invited,
        'onboarded', p.onboarded,
        'banned', p.banned_at is not null,
        'banned_at', p.banned_at,
        'banned_reason', p.banned_reason,
        'is_admin', exists (select 1 from public.admins a where a.user_id = p.id),
        'video_count', p.video_count,
        'follower_count', p.follower_count,
        'created_at', p.created_at
      ) as row
      from public.profiles p
      where (
          p_state = 'all'
          or (p_state = 'banned' and p.banned_at is not null)
          or (p_state = 'verified' and p.verified)
          or (p_state = 'invited' and p.invited)
        )
        and (
          q = ''
          or lower(p.username) like replace(replace(q, '%', ''), '_', '\_') || '%'
          or lower(p.display_name) like replace(replace(q, '%', ''), '_', '\_') || '%'
          or p.id::text = q
        )
      order by p.created_at desc, p.id desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) page
  );
end;
$$;

-- The audit log, newest first. Pass the id of the last row you have to get
-- the next page.
create or replace function public.admin_log_page(p_limit int default 50, p_before bigint default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return (
    select coalesce(jsonb_agg(row), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id', l.id,
        'action', l.action,
        'target_type', l.target_type,
        'target_id', l.target_id,
        'details', l.details,
        'created_at', l.created_at,
        'actor', public.admin_who(l.actor_id),
        -- A readable name for the target where there is one.
        'target_name', case l.target_type
          when 'account' then (select '@' || p.username from public.profiles p where p.id::text = l.target_id)
          when 'video' then (select nullif(left(v.caption, 60), '') from public.videos v where v.id::text = l.target_id)
          else null
        end
      ) as row
      from public.admin_log l
      where p_before is null or l.id < p_before
      order by l.id desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) page
  );
end;
$$;

-- Sign-ups, uploads and views per day (UTC) for the last p_days days, oldest
-- first, plus the totals and what is waiting for an admin.
create or replace function public.admin_stats(p_days int default 14)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  n int := least(greatest(coalesce(p_days, 14), 1), 90);
  today date := (now() at time zone 'utc')::date;
begin
  perform public.require_admin();
  return jsonb_build_object(
    'days', (
      select jsonb_agg(jsonb_build_object(
        'day', d.day,
        'signups', (select count(*) from public.profiles p
                     where (p.created_at at time zone 'utc')::date = d.day),
        'uploads', (select count(*) from public.videos v
                     where (v.created_at at time zone 'utc')::date = d.day and v.status <> 'failed'),
        'views', (select coalesce(sum(w.views), 0) from public.video_views w where w.day = d.day)
      ) order by d.day)
      from (select generate_series(today - (n - 1), today, interval '1 day')::date as day) d
    ),
    'totals', jsonb_build_object(
      'accounts', (select count(*) from public.profiles),
      'clips', (select count(*) from public.videos v where v.status = 'ready' and v.removed_at is null),
      'views', (select coalesce(sum(v.view_count), 0) from public.videos v),
      'open_reports', (select count(*) from public.reports r where r.status = 'open'),
      'banned', (select count(*) from public.profiles p where p.banned_at is not null),
      'in_queue', (select count(*) from public.encode_jobs j where j.status in ('queued', 'running')),
      'failed', (select count(*) from public.videos v where v.status = 'failed' and v.created_at > now() - interval '7 days')
    )
  );
end;
$$;

revoke execute on function public.admin_who(uuid) from public, anon, authenticated;
revoke execute on function public.admin_flags() from public, anon;
revoke execute on function public.admin_settings() from public, anon;
revoke execute on function public.admin_reports(text, int) from public, anon;
revoke execute on function public.admin_videos(text, text, int) from public, anon;
revoke execute on function public.admin_accounts(text, text, int) from public, anon;
revoke execute on function public.admin_log_page(int, bigint) from public, anon;
revoke execute on function public.admin_stats(int) from public, anon;
grant execute on function public.admin_flags() to authenticated;
grant execute on function public.admin_settings() to authenticated;
grant execute on function public.admin_reports(text, int) to authenticated;
grant execute on function public.admin_videos(text, text, int) to authenticated;
grant execute on function public.admin_accounts(text, text, int) to authenticated;
grant execute on function public.admin_log_page(int, bigint) to authenticated;
grant execute on function public.admin_stats(int) to authenticated;
