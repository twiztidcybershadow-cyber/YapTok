-- 005_processing.sql
-- The encode queue. A worker on its own box (worker/, ops/encoder/) turns
-- every uploaded clip into HLS, a cover image and a preview sprite.
--
-- - encode_jobs has one row per clip. A trigger queues the job the moment a
--   clip becomes 'uploaded'.
-- - The worker talks to the database only through four functions, with the
--   service role key: claim_encode_job, encode_progress, encode_done and
--   encode_failed. Nobody else can call them.
-- - A job is tried up to 3 times. A job that has been running for more than
--   2 hours 15 minutes is taken back.
-- - encode_done refuses a clip that is really longer than the
--   upload_max_seconds setting, whatever the browser said at upload time.
-- - storage_cleanup lists R2 folders to empty after a clip is deleted. The
--   worker drains it between jobs (claim_cleanup, cleanup_done, cleanup_failed).
--
-- Run after 004_videos.sql. Safe to run more than once.

create or replace function public.encode_max_attempts()
returns int
language sql
immutable
set search_path = ''
as $$ select 3 $$;

create or replace function public.encode_stale_after()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '2 hours 15 minutes' $$;

create table if not exists public.encode_jobs (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null unique references public.videos (id) on delete cascade,
  status text not null default 'queued',
  attempts int not null default 0,
  worker text,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  progress int not null default 0,
  created_at timestamptz not null default now(),
  constraint encode_jobs_status_valid check (status in ('queued', 'running', 'done', 'failed')),
  constraint encode_jobs_progress_range check (progress between 0 and 100),
  constraint encode_jobs_attempts_range check (attempts >= 0)
);

create index if not exists encode_jobs_queued_idx on public.encode_jobs (created_at)
  where status = 'queued';
create index if not exists encode_jobs_running_idx on public.encode_jobs (worker)
  where status = 'running';

alter table public.encode_jobs enable row level security;

drop policy if exists "owners read the jobs of their own clips" on public.encode_jobs;
create policy "owners read the jobs of their own clips"
  on public.encode_jobs
  for select
  to authenticated
  using (
    exists (
      select 1 from public.videos v
      where v.id = encode_jobs.video_id and v.owner_id = (select auth.uid())
    )
  );

revoke all on public.encode_jobs from anon, authenticated;
grant select on public.encode_jobs to authenticated;

-- Queue a job when a clip becomes 'uploaded'.
create or replace function public.queue_encode_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'uploaded' and (tg_op = 'INSERT' or old.status is distinct from 'uploaded') then
    insert into public.encode_jobs (video_id)
    values (new.id)
    on conflict (video_id) do update
      set status = 'queued',
          attempts = 0,
          progress = 0,
          worker = null,
          error = null,
          started_at = null,
          finished_at = null
      where public.encode_jobs.status in ('done', 'failed');
  end if;
  return new;
end;
$$;

drop trigger if exists videos_queue_encode on public.videos;
create trigger videos_queue_encode
  after insert or update of status on public.videos
  for each row execute function public.queue_encode_job();

-- Clips uploaded before this migration ran.
insert into public.encode_jobs (video_id)
select v.id from public.videos v where v.status = 'uploaded'
on conflict (video_id) do nothing;

-- One attempt is over without success: queue it again, or fail the clip.
create or replace function public.encode_give_up_attempt(job public.encode_jobs, reason text, retry boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_reason text := left(coalesce(nullif(trim(both from reason), ''), 'encode failed'), 200);
begin
  if retry and job.attempts < public.encode_max_attempts() then
    update public.encode_jobs j
       set status = 'queued', progress = 0, worker = null, error = clean_reason, finished_at = null
     where j.id = job.id;
    return 'queued';
  end if;
  update public.encode_jobs j
     set status = 'failed', error = clean_reason, finished_at = now()
   where j.id = job.id;
  update public.videos v
     set status = 'failed', error = clean_reason
   where v.id = job.video_id;
  return 'failed';
end;
$$;

-- The next job for this worker, oldest first. Also takes back jobs this
-- worker left running (it restarted) and jobs that have run for too long.
-- Nothing is handed out while the processing flag is off for the owner.
create or replace function public.claim_encode_job(worker text)
returns table (
  job_id uuid,
  video_id uuid,
  owner_id uuid,
  source_key text,
  source_bytes bigint,
  source_mime text,
  attempt int,
  cover_at numeric,
  max_seconds numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  me text := left(coalesce(nullif(trim(both from claim_encode_job.worker), ''), 'worker'), 100);
  dead public.encode_jobs;
  next_job public.encode_jobs;
  vid public.videos;
begin
  for dead in
    select * from public.encode_jobs j
     where j.status = 'running'
       and (j.worker = me or j.started_at < now() - public.encode_stale_after())
     for update skip locked
  loop
    perform public.encode_give_up_attempt(dead, 'the worker stopped during the encode', true);
  end loop;

  select j.* into next_job
    from public.encode_jobs j
    join public.videos v on v.id = j.video_id
   where j.status = 'queued'
     and v.status in ('uploaded', 'processing')
     and v.source_key is not null
     and public.flag_on('processing', v.owner_id)
   order by j.created_at
   limit 1
   for update of j skip locked;
  if next_job.id is null then
    return;
  end if;

  update public.encode_jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         worker = me,
         started_at = now(),
         finished_at = null,
         progress = 0
   where j.id = next_job.id
  returning * into next_job;

  update public.videos v
     set status = 'processing', error = null
   where v.id = next_job.video_id
  returning * into vid;

  return query select next_job.id, vid.id, vid.owner_id, vid.source_key, vid.source_bytes, vid.source_mime,
                      next_job.attempts, vid.cover_at,
                      coalesce((public.site_setting('upload_max_seconds') #>> '{}')::numeric, 60);
end;
$$;

-- False when the job is not running any more (taken back as stale).
create or replace function public.encode_progress(job_id uuid, pct int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.encode_jobs j
     set progress = greatest(0, least(100, coalesce(encode_progress.pct, 0)))
   where j.id = encode_progress.job_id and j.status = 'running';
  return found;
end;
$$;

-- The encode worked: save what the worker made and publish the clip.
-- Errors: not_found, not_running, bad_renditions
create or replace function public.encode_done(
  job_id uuid,
  duration_s numeric,
  width int,
  height int,
  hls_key text,
  thumbnail_url text,
  preview_sprite_key text,
  renditions jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.encode_jobs;
  max_s numeric := coalesce((public.site_setting('upload_max_seconds') #>> '{}')::numeric, 60);
begin
  select * into job from public.encode_jobs j where j.id = encode_done.job_id for update;
  if job.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if job.status = 'done' then
    return 'done';
  end if;
  if job.status <> 'running' then
    raise exception 'not_running' using errcode = 'P0001';
  end if;
  if encode_done.renditions is null or jsonb_typeof(encode_done.renditions) <> 'array'
     or jsonb_array_length(encode_done.renditions) = 0 then
    raise exception 'bad_renditions' using errcode = 'P0001';
  end if;

  -- The real length decides, not what the browser said at upload time.
  if encode_done.duration_s is not null and encode_done.duration_s > max_s + 1 then
    return public.encode_give_up_attempt(
      job, 'this clip is longer than ' || max_s::text || ' seconds, the longest a clip can be', false);
  end if;

  update public.encode_jobs j
     set status = 'done', progress = 100, error = null, finished_at = now()
   where j.id = job.id;

  update public.videos v
     set status = 'ready',
         duration_s = encode_done.duration_s,
         width = encode_done.width,
         height = encode_done.height,
         hls_key = encode_done.hls_key,
         thumbnail_url = nullif(encode_done.thumbnail_url, ''),
         preview_sprite_key = encode_done.preview_sprite_key,
         renditions = encode_done.renditions,
         error = null
   where v.id = job.video_id;
  return 'done';
end;
$$;

-- 'queued' when it will be tried again, 'failed' when the clip is failed.
create or replace function public.encode_failed(job_id uuid, error text, retry boolean default true)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.encode_jobs;
begin
  select * into job from public.encode_jobs j where j.id = encode_failed.job_id for update;
  if job.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if job.status = 'failed' then
    return 'failed';
  end if;
  if job.status <> 'running' then
    raise exception 'not_running' using errcode = 'P0001';
  end if;
  return public.encode_give_up_attempt(job, encode_failed.error, coalesce(encode_failed.retry, true));
end;
$$;

-- Storage cleanup -----------------------------------------------------------------

-- R2 folders to delete. No foreign key: the clip row is gone by then.
create table if not exists public.storage_cleanup (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null,
  prefix text not null,
  status text not null default 'queued',
  attempts int not null default 0,
  worker text,
  error text,
  deleted_objects int,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint storage_cleanup_status_valid check (status in ('queued', 'running', 'done', 'failed')),
  -- Only the two folders a clip has, so a bad row can never empty the bucket.
  constraint storage_cleanup_prefix_valid check (
    prefix ~ '^hls/[0-9a-f-]{36}/$' or prefix ~ '^uploads/[0-9a-f-]{36}/[0-9a-f-]{36}/$'
  ),
  constraint storage_cleanup_once unique (prefix)
);

create index if not exists storage_cleanup_todo_idx on public.storage_cleanup (queued_at)
  where status in ('queued', 'failed', 'running');

alter table public.storage_cleanup enable row level security;
revoke all on public.storage_cleanup from anon, authenticated;

-- Whenever a clip row goes (the owner deleted it, or the account was
-- deleted), queue its two folders.
create or replace function public.videos_queue_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.storage_cleanup (video_id, prefix)
  values
    (old.id, 'hls/' || old.id::text || '/'),
    (old.id, 'uploads/' || old.owner_id::text || '/' || old.id::text || '/')
  on conflict on constraint storage_cleanup_once do update
    set status = 'queued', attempts = 0, error = null, queued_at = now();
  return old;
end;
$$;

drop trigger if exists videos_queue_cleanup on public.videos;
create trigger videos_queue_cleanup
  after delete on public.videos
  for each row execute function public.videos_queue_cleanup();

-- The owner deletes one of their clips for good. Errors: not_signed_in, not_found
create or replace function public.delete_video(video_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  delete from public.videos v where v.id = delete_video.video_id and v.owner_id = me;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end;
$$;

-- The next folders for the worker. Queued and failed rows (under 5 tries),
-- and running rows left behind for 15 minutes.
create or replace function public.claim_cleanup(worker text, lim int default 20)
returns table (id uuid, prefix text, attempt int)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
  with picked as (
    select c.id
    from public.storage_cleanup c
    where (c.status in ('queued', 'failed') and c.attempts < 5)
       or (c.status = 'running' and c.started_at < now() - interval '15 minutes')
    order by c.queued_at, c.id
    limit least(greatest(coalesce(claim_cleanup.lim, 20), 1), 100)
    for update skip locked
  )
  update public.storage_cleanup c
     set status = 'running', attempts = c.attempts + 1, worker = left(claim_cleanup.worker, 100),
         started_at = now(), error = null
    from picked p
   where c.id = p.id
  returning c.id, c.prefix, c.attempts;
end;
$$;

create or replace function public.cleanup_done(cleanup_id uuid, deleted int default null)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.storage_cleanup c
     set status = 'done', finished_at = now(), error = null, deleted_objects = cleanup_done.deleted
   where c.id = cleanup_done.cleanup_id;
$$;

create or replace function public.cleanup_failed(cleanup_id uuid, error text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.storage_cleanup c
     set status = 'failed', finished_at = now(), error = left(coalesce(cleanup_failed.error, ''), 500)
   where c.id = cleanup_failed.cleanup_id;
$$;

-- Who may call what ----------------------------------------------------------------

revoke execute on function public.claim_encode_job(text) from public, anon, authenticated;
revoke execute on function public.encode_progress(uuid, int) from public, anon, authenticated;
revoke execute on function public.encode_done(uuid, numeric, int, int, text, text, text, jsonb)
  from public, anon, authenticated;
revoke execute on function public.encode_failed(uuid, text, boolean) from public, anon, authenticated;
revoke execute on function public.encode_give_up_attempt(public.encode_jobs, text, boolean)
  from public, anon, authenticated;
revoke execute on function public.queue_encode_job() from public, anon, authenticated;
revoke execute on function public.videos_queue_cleanup() from public, anon, authenticated;
revoke execute on function public.claim_cleanup(text, int) from public, anon, authenticated;
revoke execute on function public.cleanup_done(uuid, int) from public, anon, authenticated;
revoke execute on function public.cleanup_failed(uuid, text) from public, anon, authenticated;
revoke execute on function public.delete_video(uuid) from public, anon;

grant execute on function public.claim_encode_job(text) to service_role;
grant execute on function public.encode_progress(uuid, int) to service_role;
grant execute on function public.encode_done(uuid, numeric, int, int, text, text, text, jsonb) to service_role;
grant execute on function public.encode_failed(uuid, text, boolean) to service_role;
grant execute on function public.claim_cleanup(text, int) to service_role;
grant execute on function public.cleanup_done(uuid, int) to service_role;
grant execute on function public.cleanup_failed(uuid, text) to service_role;
grant execute on function public.delete_video(uuid) to authenticated;

insert into public.feature_flags (key, label, description, mode)
values
  ('processing', 'Processing', 'The encoder worker turns uploads into HLS, a cover and a preview sprite. While it is off, uploads wait in the queue.', 'off')
on conflict (key) do nothing;
