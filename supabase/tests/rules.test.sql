-- rules.test.sql
-- Checks the rules in the migrations against a real PostgreSQL, as the three
-- API roles: who can read what, who can call what, and that every admin
-- action is refused for anyone who is not in the admins table.
-- Run by scripts/db-test.mjs on a throwaway database. Stops at the first
-- failure; every passing check prints "ok - <name>".

\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema t;
grant usage on schema t to anon, authenticated, service_role;

-- Become a signed in person, a signed out visitor, the worker, or the owner again.
create function t.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;
create function t.anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', false);
  set role anon;
end $$;
create function t.worker() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', false);
  set role service_role;
end $$;

create function t.ok(got boolean, name text) returns void language plpgsql as $$
begin
  if got is not true then
    raise exception 'FAILED - %', name;
  end if;
  raise notice 'ok - %', name;
end $$;

create function t.is(got anyelement, want anyelement, name text) returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAILED - %: got %, wanted %', name, got, want;
  end if;
  raise notice 'ok - %', name;
end $$;

-- Runs a statement and answers the error message, or 'no error'.
create function t.err(statement text) returns text language plpgsql as $$
begin
  execute statement;
  return 'no error';
exception when others then
  return sqlerrm;
end $$;

grant execute on all functions in schema t to anon, authenticated, service_role;

-- People ----------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'owner@example.com', '{"username": "owner"}'),
  ('00000000-0000-4000-8000-00000000000b', 'bea@example.com', '{"username": "bea"}'),
  ('00000000-0000-4000-8000-00000000000c', 'cal@example.com', '{"username": "cal"}');
\set owner '''00000000-0000-4000-8000-00000000000a'''
\set bea '''00000000-0000-4000-8000-00000000000b'''
\set cal '''00000000-0000-4000-8000-00000000000c'''

select t.is((select count(*)::int from public.profiles), 3, 'the signup trigger makes a profile per user');
select t.is((select username from public.profiles where id = :bea), 'bea', 'the wanted username is kept');

insert into public.admins (user_id, note) values (:owner, 'owner');

select t.login(:bea);
select public.complete_signup('bea', date '2000-01-01');
select t.is(t.err($$select public.complete_signup('bea', date '2000-01-01')$$), 'already_complete', 'complete_signup runs once');
select t.login(:cal);
select t.is(t.err($$select public.complete_signup('cal', (current_date - 3650))$$), 'too_young', 'under 13 is refused');
select public.complete_signup('cal', date '1999-05-05');
select t.is(t.err($$select birthdate from public.profiles$$), 'permission denied for table profiles', 'birthdate is not readable');
select t.is(t.err($$select banned_at from public.profiles$$), 'permission denied for table profiles', 'ban columns are not readable');
select t.is(t.err($$update public.profiles set verified = true where id = auth.uid()$$), 'permission denied for table profiles', 'nobody verifies themselves');
select t.is(t.err($$update public.profiles set bio = 'hi' where id = auth.uid()$$), 'no error', 'people edit their own bio');
update public.profiles set bio = 'hacked' where username = 'bea';
reset role;
select t.is((select bio from public.profiles where username = 'bea'), '', 'people cannot edit someone else''s profile');

-- Flags and settings: admins only, in the database --------------------------------------

select t.anon();
select t.ok((select count(*) > 5 from public.feature_flags), 'everyone can read the flags');
select t.is(t.err($$update public.feature_flags set mode = 'everyone'$$), 'permission denied for table feature_flags', 'visitors cannot write flags');
select t.is(t.err($$select public.set_feature_flag('feed', 'everyone')$$), 'permission denied for function set_feature_flag', 'visitors cannot call set_feature_flag');
select t.is(t.err($$select * from public.admins$$), 'permission denied for table admins', 'visitors cannot read the admins table');
select t.is(public.is_admin(), false, 'a visitor is not an admin');

select t.login(:bea);
select t.is(t.err($$select public.set_feature_flag('feed', 'everyone')$$), 'not_admin', 'set_feature_flag refuses a normal account');
select t.is(t.err($$select public.set_site_setting('signups_open', 'false')$$), 'not_admin', 'set_site_setting refuses a normal account');
select t.is(t.err($$update public.feature_flags set mode = 'everyone'$$), 'permission denied for table feature_flags', 'accounts cannot write flags directly');
select t.is(t.err($$update public.site_settings set value = '5'$$), 'permission denied for table site_settings', 'accounts cannot write settings directly');
select t.is(t.err($$insert into public.admins (user_id) values (auth.uid())$$), 'permission denied for table admins', 'nobody makes themselves admin');
select t.is(t.err($$select * from public.admin_log$$), 'permission denied for table admin_log', 'the audit log is not readable directly');
select t.is(t.err($$select public.admin_flags()$$), 'not_admin', 'admin_flags refuses a normal account');
select t.is(t.err($$select public.admin_settings()$$), 'not_admin', 'admin_settings refuses a normal account');
select t.is(t.err($$select public.admin_reports()$$), 'not_admin', 'admin_reports refuses a normal account');
select t.is(t.err($$select public.admin_videos()$$), 'not_admin', 'admin_videos refuses a normal account');
select t.is(t.err($$select public.admin_accounts()$$), 'not_admin', 'admin_accounts refuses a normal account');
select t.is(t.err($$select public.admin_log_page()$$), 'not_admin', 'admin_log_page refuses a normal account');
select t.is(t.err($$select public.admin_stats()$$), 'not_admin', 'admin_stats refuses a normal account');
select t.is(t.err($$select public.admin_ban('00000000-0000-4000-8000-00000000000c')$$), 'not_admin', 'admin_ban refuses a normal account');
select t.is(t.err($$select public.admin_unban('00000000-0000-4000-8000-00000000000c')$$), 'not_admin', 'admin_unban refuses a normal account');
select t.is(t.err($$select public.admin_set_mark(auth.uid(), 'verified', true)$$), 'not_admin', 'admin_set_mark refuses a normal account');
select t.is(t.err($$select public.admin_remove_video(gen_random_uuid())$$), 'not_admin', 'admin_remove_video refuses a normal account');
select t.is(t.err($$select public.admin_restore_video(gen_random_uuid())$$), 'not_admin', 'admin_restore_video refuses a normal account');
select t.is(t.err($$select public.admin_remove_comment(gen_random_uuid())$$), 'not_admin', 'admin_remove_comment refuses a normal account');
select t.is(t.err($$select public.admin_restore_comment(gen_random_uuid())$$), 'not_admin', 'admin_restore_comment refuses a normal account');
select t.is(t.err($$select public.admin_dismiss_report(gen_random_uuid())$$), 'not_admin', 'admin_dismiss_report refuses a normal account');
select t.is(t.err($$select public.require_admin()$$), 'permission denied for function require_admin', 'internal helpers are not callable');
select t.is(t.err($$select public.admin_log_add(auth.uid(), 'x', 'x', 'x')$$), 'permission denied for function admin_log_add', 'nobody writes the audit log by hand');

select t.login(:owner);
select t.is(public.is_admin(), true, 'the owner is an admin');
select t.is(t.err($$select public.set_feature_flag('feed', 'sometimes')$$), 'bad_mode', 'a flag mode must be off, test or everyone');
select t.is(t.err($$select public.set_feature_flag('nope', 'off')$$), 'not_found', 'an unknown flag is refused');
select t.is(t.err($$select public.set_feature_flag('admin', 'off')$$), 'locked', 'the admin flag cannot be switched off from the panel');
select public.set_feature_flag('feed', 'test');
reset role;
select t.is((select users from public.feature_flags where key = 'feed'), array[:owner::uuid], 'test mode lists the admin who pressed it');
select t.is((select updated_by from public.feature_flags where key = 'feed'), :owner::uuid, 'the flag remembers who changed it');
select t.is((select details ->> 'to' from public.admin_log where action = 'flag.set' order by id desc limit 1), 'test', 'flag changes are in the audit log');

select t.login(:owner);
select public.set_feature_flag(k, 'everyone') from unnest(array['feed', 'upload', 'processing', 'likes', 'follows', 'comments', 'profiles', 'share', 'reports']) k;
select t.is(t.err($$select public.set_site_setting('upload_max_seconds', '2')$$), 'bad_value', 'a number setting respects its minimum');
select t.is(t.err($$select public.set_site_setting('upload_max_seconds', '"60"')$$), 'bad_value', 'a number setting must be a number');
select t.is(t.err($$select public.set_site_setting('upload_who', '"friends"')$$), 'bad_value', 'a choice setting must be one of its options');
select t.is(t.err($$select public.set_site_setting('comments_enabled', '"yes"')$$), 'bad_value', 'a boolean setting must be true or false');
select t.is(t.err($$select public.set_site_setting('maintenance_banner', to_jsonb(repeat('x', 201)))$$), 'bad_value', 'the banner has a length limit');
select t.is(t.err($$select public.set_site_setting('nope', '1')$$), 'not_found', 'an unknown setting is refused');
select public.set_site_setting('maintenance_banner', '"Uploads are slow today"');
select t.anon();
select t.is((select value #>> '{}' from public.site_settings where key = 'maintenance_banner'), 'Uploads are slow today', 'everyone reads the banner text');

-- Sign-ups closed -------------------------------------------------------------------------

select t.login(:owner);
select public.set_site_setting('signups_open', 'false');
reset role;
select t.is(t.err($$insert into auth.users (email) values ('late@example.com')$$), 'signups_closed', 'no new accounts while sign-ups are closed');
select t.login(:owner);
select public.set_site_setting('signups_open', 'true');
reset role;

-- Upload rules ----------------------------------------------------------------------------

select t.anon();
select t.is(t.err($$select public.create_upload('hi', '{}', 1000, 'video/mp4')$$), 'permission denied for function create_upload', 'visitors cannot upload');

select t.login(:bea);
select t.is(t.err($$select public.create_upload('hi', '{}', 1000, 'image/png')$$), 'bad_type', 'only video types');
select t.is(t.err($$select public.create_upload('hi', '{}', 300 * 1024 * 1024, 'video/mp4')$$), 'file_too_big', 'the size limit comes from the setting');
select t.is(t.err($$select public.create_upload('hi', '{}', 1000, 'video/mp4', 90)$$), 'too_long', 'the length limit comes from the setting');
select t.is(t.err($$select public.create_upload(repeat('x', 301), '{}', 1000, 'video/mp4')$$), 'caption_too_long', 'captions stop at 300 characters');

select t.login(:owner);
select public.set_site_setting('upload_max_seconds', '120');
select public.set_site_setting('upload_who', '"verified"');
select t.login(:bea);
select t.is(t.err($$select public.create_upload('hi', '{}', 1000, 'video/mp4', 90)$$), 'not_allowed', 'verified only: a normal account is refused');
select t.login(:owner);
select public.admin_set_mark(:bea, 'verified', true);
select t.login(:bea);
create temp table up as select * from public.create_upload('My first clip', array['#Cats', 'cats', 'so cute', 'fun_1'], 1000, 'video/mp4', 90, 1.5);
grant select on up to public;
select t.ok((select source_key ~ '^uploads/00000000-0000-4000-8000-00000000000b/[0-9a-f-]{36}/source\.mp4$' from up), 'the upload key is in the owner''s folder');
select t.is((select hashtags from public.videos where id = (select video_id from up)), array['cats', 'fun_1'], 'hashtags are cleaned and deduplicated');
select t.is(t.err($$insert into public.videos (owner_id) values (auth.uid())$$), 'permission denied for table videos', 'clips are only made through create_upload');
select t.is(t.err($$update public.videos set status = 'ready'$$), 'permission denied for table videos', 'nobody marks their own clip ready');
select t.is(t.err($$select public.encode_done(gen_random_uuid(), 1, 1, 1, 'x', 'x', 'x', '[]')$$), 'permission denied for function encode_done', 'accounts cannot call the worker functions');
select t.is(t.err($$select public.claim_encode_job('me')$$), 'permission denied for function claim_encode_job', 'accounts cannot claim encode jobs');
select t.is(public.finish_upload((select video_id from up)), 'uploaded', 'finish_upload marks it uploaded');
select t.is((select count(*)::int from public.encode_jobs), 1, 'an encode job is queued, and its owner can see it');

select t.login(:cal);
select t.is((select count(*)::int from public.videos), 0, 'a clip that is not ready is hidden from others');
select t.is((select count(*)::int from public.encode_jobs), 0, 'other people do not see the job');
select t.is(t.err(format($$select public.finish_upload(%L)$$, (select video_id from up))), 'not_found', 'only the owner finishes an upload');

select t.login(:owner);
select public.set_site_setting('upload_who', '"everyone"');
select public.set_site_setting('upload_daily_limit', '1');
select t.login(:bea);
select t.is(t.err($$select public.create_upload('second', '{}', 1000, 'video/mp4')$$), 'daily_limit', 'the daily limit comes from the setting');
select t.login(:owner);
select public.set_site_setting('upload_daily_limit', '10');

-- The worker ------------------------------------------------------------------------------

select t.worker();
create temp table job as select * from public.claim_encode_job('test-worker');
grant select on job to public;
select t.is((select video_id from job), (select video_id from up), 'the worker claims the job');
select t.is((select cover_at from job), 1.5, 'the worker is told where the cover frame is');
select t.is((select max_seconds from job), 120::numeric, 'the worker is told the length limit');
select t.is(public.encode_progress((select job_id from job), 40), true, 'progress is saved');
select t.is(public.encode_done((select job_id from job), 500, 1080, 1920, 'hls/x/master.m3u8', '', 'hls/x/sprite.vtt', '[{"name":"720p"}]'), 'failed', 'a clip that is really too long is failed by encode_done');
reset role;
select t.is((select status from public.videos where id = (select video_id from up)), 'failed', 'the clip is marked failed');

-- A second clip that makes it to ready.
select t.login(:bea);
create temp table up2 as select * from public.create_upload('Ready clip', array['yap'], 2000, 'video/mp4', 12);
grant select on up2 to public;
select public.finish_upload((select video_id from up2));
select t.worker();
create temp table job2 as select * from public.claim_encode_job('test-worker');
grant select on job2 to public;
select t.is(public.encode_done((select job_id from job2), 12.5, 720, 1280,
  'hls/' || (select video_id from job2) || '/master.m3u8', 'https://media.example.com/t.webp',
  'hls/' || (select video_id from job2) || '/sprite.vtt', '[{"name":"720p"}]'), 'done', 'encode_done publishes the clip');
reset role;
\set clip '(select video_id from up2)'
select t.ok((select published_at is not null from public.videos where id = :clip), 'published_at is set when the clip goes live');
select t.is((select video_count from public.profiles where username = 'bea'), 1, 'the profile counts the live clip');

-- Feed, likes, follows, comments --------------------------------------------------------------

select t.anon();
select t.is(jsonb_array_length(public.feed_page()), 1, 'a visitor sees the clip in the feed');
select t.is(public.feed_page() -> 0 -> 'author' ->> 'username', 'bea', 'the feed carries the creator');
select t.is(t.err(format($$select public.toggle_like(%L)$$, :clip)), 'permission denied for function toggle_like', 'visitors cannot like');
select t.is(public.record_view(:clip, 'abcdefghijklmnop1234'), true, 'a visitor''s view counts');
select t.is(public.record_view(:clip, 'abcdefghijklmnop1234'), false, 'the same visitor does not count twice a day');
select t.is(public.record_view(:clip, 'short'), false, 'a view needs a proper viewer key');

select t.login(:cal);
select t.is(public.toggle_like(:clip) ->> 'like_count', '1', 'a like counts');
select t.is(public.toggle_like(:clip, true) ->> 'like_count', '1', 'liking twice still counts once');
select t.is(public.feed_page() -> 0 ->> 'liked', 'true', 'the feed knows what you liked');
select t.is(t.err(format($$insert into public.likes (video_id, user_id) values (%L, auth.uid())$$, :clip)), 'permission denied for table likes', 'likes only go through toggle_like');
select t.is(public.toggle_follow(:bea) ->> 'follower_count', '1', 'a follow counts');
select t.is(t.err($$select public.toggle_follow(auth.uid())$$), 'self', 'nobody follows themselves');
select t.is(jsonb_array_length(public.following_page()), 0, 'the Following feed is empty while its flag is off');
reset role;
update public.feature_flags set mode = 'everyone' where key = 'following';
select t.login(:cal);
select t.is(jsonb_array_length(public.following_page()), 1, 'the Following feed has the clips of people you follow');
select t.login(:owner);
select t.is(jsonb_array_length(public.following_page()), 0, 'and nothing from people you do not follow');
select t.anon();
select t.is(t.err($$select public.following_page()$$), 'permission denied for function following_page', 'visitors have no Following feed');
select t.login(:cal);
select t.is(public.add_comment(:clip, E'  nice\nclip  ') ->> 'body', 'nice clip', 'a comment is trimmed to one line');
select t.is(t.err(format($$select public.add_comment(%L, '')$$, :clip)), 'comment_invalid', 'an empty comment is refused');
select t.is(jsonb_array_length(public.video_comments(:clip)), 1, 'the comment is listed');
create temp table first_comment as select (public.video_comments(:clip) -> 0 ->> 'id')::uuid as id;
grant select on first_comment to public;
select t.is(t.err(format($$select public.add_comment(%L, 'a reply', %L)$$, :clip, (select id from first_comment))), 'replies_off', 'replies are off until their flag is on');
reset role;
update public.feature_flags set mode = 'everyone' where key = 'comment_threads';
select t.login(:bea);
select t.is(public.add_comment(:clip, 'thank you!', (select id from first_comment)) ->> 'parent_id', (select id::text from first_comment), 'a reply hangs under its comment');
select t.is(public.toggle_comment_like((select id from first_comment)) ->> 'like_count', '1', 'a comment like counts');
select t.is(t.err(format($$select public.add_comment(%L, 'x', gen_random_uuid())$$, :clip)), 'not_found', 'a reply needs a real comment on the same clip');
select t.login(:cal);
select t.is(jsonb_array_length(public.video_comments(:clip)), 1, 'replies are not in the top level list');
select t.is(public.video_comments(:clip) -> 0 ->> 'reply_count', '1', 'the comment counts its replies');
select t.is(public.video_comments(:clip) -> 0 ->> 'liked', 'false', 'someone else''s like is not yours');
select t.is(public.comment_replies((select id from first_comment)) -> 0 ->> 'body', 'thank you!', 'the replies are listed');
select t.is(t.err($$insert into public.comment_likes (comment_id, user_id) select id, auth.uid() from first_comment$$), 'permission denied for table comment_likes', 'comment likes only go through the function');
select t.is(public.record_view(:clip), true, 'a signed in view counts');
select t.is(public.record_share(:clip), 1, 'a share counts');
select t.is(t.err(format($$select public.toggle_save(%L)$$, :clip)), 'saves_off', 'saving is off until its flag is on');
reset role;
update public.feature_flags set mode = 'everyone' where key = 'saves';
select t.login(:cal);
select t.is(public.toggle_save(:clip) ->> 'save_count', '1', 'a save counts');
select t.is(public.feed_page() -> 0 ->> 'saved', 'true', 'the feed knows what you saved');
select t.is(jsonb_array_length(public.my_clips('saved')), 1, 'your saved list has it');
select t.is(jsonb_array_length(public.my_clips('liked')), 1, 'your liked list has what you liked');
select t.is(t.err(format($$insert into public.saves (video_id, user_id) values (%L, auth.uid())$$, :clip)), 'permission denied for table saves', 'saves only go through toggle_save');
select t.login(:bea);
select t.is((select count(*)::int from public.saves), 0, 'nobody reads someone else''s saves');
select t.is(jsonb_array_length(public.my_clips('saved')), 0, 'and their saved list is their own');
select t.anon();
select t.is(t.err($$select public.my_clips('saved')$$), 'permission denied for function my_clips', 'visitors have no saved list');
select t.login(:cal);
reset role;
select t.is((select comment_count from public.videos where id = :clip), 2, 'the clip counts its comments and replies');
select t.is((select view_count::int from public.videos where id = :clip), 2, 'the clip counts its views');
select t.is((select like_count from public.profiles where username = 'bea'), 1, 'the profile counts likes on its clips');

select t.login(:owner);
select public.set_site_setting('comments_enabled', 'false');
select t.login(:cal);
select t.is(t.err(format($$select public.add_comment(%L, 'again')$$, :clip)), 'comments_off', 'the Comments setting stops new comments');
select t.is(jsonb_array_length(public.video_comments(:clip)), 1, 'old comments stay readable');
select t.login(:owner);
select public.set_site_setting('comments_enabled', 'true');
select public.set_feature_flag('likes', 'off');
select t.login(:cal);
select t.is(t.err(format($$select public.toggle_like(%L)$$, :clip)), 'likes_off', 'a switched off flag is off in the database too');
select t.login(:owner);
select public.set_feature_flag('likes', 'everyone');

select t.anon();
select t.is(public.profile_page('BEA') -> 'profile' ->> 'follower_count', '1', 'the profile page finds a creator in any case');
select t.is(jsonb_array_length(public.profile_page('bea') -> 'videos'), 1, 'a visitor sees only live clips on a profile');
select t.login(:bea);
select t.is(jsonb_array_length(public.profile_page('bea') -> 'videos'), 2, 'the owner also sees their failed clip');

-- The inbox -----------------------------------------------------------------------------------

select t.login(:bea);
select t.is(public.inbox_unread(), 0, 'nothing is written while the inbox flag is off');
reset role;
update public.feature_flags set mode = 'everyone' where key = 'inbox';
select t.login(:cal);
select public.toggle_like(:clip, false);
select public.toggle_like(:clip, true);
select public.toggle_like(:clip, false);
select public.toggle_like(:clip, true);
select public.add_comment(:clip, 'one more');
select t.is(public.inbox_unread(), 0, 'your own actions never notify you');
select t.login(:bea);
select t.is(public.inbox_unread(), 2, 'a like and a comment notify the creator, the same like only once');
select t.is(public.inbox_page() -> 0 ->> 'kind', 'comment', 'newest first');
select t.is(public.inbox_page() -> 0 -> 'actor' ->> 'username', 'cal', 'with who did it');
select t.is(t.err($$select * from public.notifications$$), 'permission denied for table notifications', 'notifications are not readable directly');
select public.inbox_mark_read();
select t.is(public.inbox_unread(), 0, 'marking read clears the count');
select t.login(:cal);
select t.is(jsonb_array_length(public.inbox_page()), 0, 'nobody sees someone else''s inbox');
select t.anon();
select t.is(t.err($$select public.inbox_page()$$), 'permission denied for function inbox_page', 'visitors have no inbox');

-- Messages ------------------------------------------------------------------------------------

select t.login(:cal);
select t.is(t.err($$select public.send_message('00000000-0000-4000-8000-00000000000b', 'hi')$$), 'messages_off', 'messages are off until their flag is on');
reset role;
update public.feature_flags set mode = 'everyone' where key = 'messages';
select t.login(:cal);
select t.is(public.send_message(:bea, E'  hello\nthere ') ->> 'body', 'hello there', 'a message is sent, trimmed to one line');
select t.is(public.send_message(:bea, '', :clip) -> 'video' ->> 'username', 'bea', 'a clip can be sent along');
select t.is(t.err($$select public.send_message(auth.uid(), 'me')$$), 'self', 'nobody messages themselves');
select t.is(t.err($$select public.send_message('00000000-0000-4000-8000-00000000000b', '')$$), 'message_invalid', 'an empty message is refused');
select t.is(t.err($$select public.send_message(gen_random_uuid(), 'hi')$$), 'not_found', 'the other account must exist');
select t.is(t.err($$select * from public.messages$$), 'permission denied for table messages', 'messages are not readable directly');
select t.login(:bea);
select t.is(public.dm_unread(), 2, 'the receiver has two unread');
select t.is(public.dm_threads() -> 0 -> 'with' ->> 'username', 'cal', 'the conversation is listed');
select t.is((public.dm_threads() -> 0 ->> 'unread')::int, 2, 'with its unread count');
select t.is(jsonb_array_length(public.dm_thread('cal') -> 'messages'), 2, 'the conversation has both messages, oldest first');
select t.is(public.dm_unread(), 0, 'opening it marks them read');
select t.login(:owner);
select t.is(jsonb_array_length(public.dm_threads()), 0, 'nobody sees someone else''s conversations');
select t.is(jsonb_array_length(public.dm_thread('cal') -> 'messages'), 0, 'or reads them by asking for one side');
select t.anon();
select t.is(t.err($$select public.dm_threads()$$), 'permission denied for function dm_threads', 'visitors have no messages');

-- Hashtags, search, Discover ----------------------------------------------------------------

select t.anon();
select t.is(public.hashtag_page('yap'), null, 'hashtag pages are off until their flag is on');
select t.is(public.search_all('ready'), null, 'search is off until its flag is on');
select t.is(public.discover_page(), null, 'Discover is off until its flag is on');
reset role;
update public.feature_flags set mode = 'everyone' where key in ('hashtags', 'search', 'discover');
select t.anon();
select t.is(public.hashtag_page('#YAP') ->> 'clip_count', '1', 'a hashtag page counts its clips, whatever the case');
select t.is(jsonb_array_length(public.hashtag_page('yap') -> 'videos'), 1, 'and lists them');
select t.is(public.hashtag_page('cats') ->> 'clip_count', '0', 'a failed clip is not on its hashtag page');
select t.is(public.hashtag_page('no such tag!'), null, 'a hashtag that cannot exist has no page');
select t.is(jsonb_array_length(public.search_all('ready') -> 'clips'), 1, 'search finds a clip by its caption');
select t.is(jsonb_array_length(public.search_all('#ya') -> 'tags'), 1, 'and a hashtag by its start');
select t.is(public.search_all('@be') -> 'people' -> 0 ->> 'username', 'bea', 'and a person by the start of the username');
select t.is(jsonb_array_length(public.search_all('%') -> 'clips'), 0, 'a wildcard is just a character');
select t.is(jsonb_array_length(public.search_all('r') -> 'clips'), 0, 'one letter is not a search');
select t.is(jsonb_array_length(public.discover_page() -> 'clips'), 1, 'Discover lists popular clips');
select t.is(public.discover_page() -> 'creators' -> 0 ->> 'username', 'bea', 'and creators with clips');
select t.is(public.discover_page() -> 'tags' -> 0 ->> 'tag', 'yap', 'and trending hashtags');

select t.is(public.follow_list('bea', 'followers'), null, 'follower lists are off until their flag is on');
reset role;
update public.feature_flags set mode = 'everyone' where key = 'follow_lists';
select t.anon();
select t.is(public.follow_list('BEA', 'followers') -> 'people' -> 0 ->> 'username', 'cal', 'a creator''s followers are listed');
select t.is(public.follow_list('cal', 'following') -> 'people' -> 0 ->> 'username', 'bea', 'and who an account follows');
select t.is(jsonb_array_length(public.follow_list('bea', 'following') -> 'people'), 0, 'an empty list is empty');
select t.is(public.follow_list('nobody_here', 'followers'), null, 'no such account, no list');
select t.is(public.follow_list('bea', 'friends'), null, 'only the two kinds exist');

-- Reports and moderation --------------------------------------------------------------------

select t.login(:cal);
select t.is(public.report_content('video', :clip, 'spam', 'looks like an ad'), 'reported', 'a report is filed');
select t.is(public.report_content('video', :clip, 'spam'), 'already', 'one open report per person and clip');
select t.is(t.err(format($$select public.report_content('video', %L, 'boring')$$, :clip)), 'bad_reason', 'the reason must be on the list');
select t.is(t.err($$select * from public.reports$$), 'permission denied for table reports', 'reports are not readable directly');

select t.login(:owner);
select t.is(jsonb_array_length(public.admin_reports('open')), 1, 'the report is in the queue');
select public.admin_remove_video(:clip, 'spam');
select t.is(jsonb_array_length(public.admin_reports('open')), 0, 'removing the clip closes its reports');
select t.is(public.admin_reports('closed') -> 0 ->> 'status', 'actioned', 'the report is marked actioned');
select t.anon();
select t.is(jsonb_array_length(public.feed_page()), 0, 'a removed clip leaves the feed');
select t.is((select count(*)::int from public.videos), 0, 'a removed clip is not readable');
select t.is(jsonb_array_length(public.video_comments(:clip)), 0, 'its comments go with it');
select t.is(jsonb_array_length(public.search_all('ready') -> 'clips'), 0, 'and it leaves search');
select t.is(public.hashtag_page('yap') ->> 'clip_count', '0', 'and its hashtag page');
select t.login(:bea);
select t.is(public.video_by_id(:clip) ->> 'removed', 'true', 'the owner still sees it, marked removed');
reset role;
select t.is((select video_count from public.profiles where username = 'bea'), 0, 'the profile count drops');
select t.login(:owner);
select public.admin_restore_video(:clip);
select t.anon();
select t.is(jsonb_array_length(public.feed_page()), 1, 'a restored clip is back in the feed');

select t.login(:owner);
select t.is(t.err($$select public.admin_ban(auth.uid())$$), 'self', 'an admin cannot ban themselves');
select public.admin_ban(:bea, 'spam account');
select t.is(public.admin_accounts('bea') -> 0 ->> 'banned', 'true', 'the accounts list shows the ban');
select t.anon();
select t.is(jsonb_array_length(public.feed_page()), 0, 'a banned creator''s clips leave the feed');
select t.is((select count(*)::int from public.videos), 0, 'and are not readable');
select t.login(:bea);
select t.is(public.session_status() ->> 'banned', 'true', 'the banned account is told so');
select t.is(t.err($$select public.create_upload('x', '{}', 1000, 'video/mp4')$$), 'banned', 'a banned account cannot upload');
select t.is(t.err(format($$select public.add_comment(%L, 'x')$$, :clip)), 'banned', 'a banned account cannot comment');
select t.is(t.err($$select public.toggle_follow('00000000-0000-4000-8000-00000000000c')$$), 'banned', 'a banned account cannot follow');
select t.login(:owner);
select public.admin_unban(:bea);
select t.anon();
select t.is(jsonb_array_length(public.feed_page()), 1, 'unbanning brings the clips back');

select t.login(:owner);
select t.ok((public.admin_stats(7) -> 'days' -> 6 ->> 'views')::int = 2, 'the stats page counts today''s views');
select t.ok((public.admin_stats(7) -> 'days' -> 6 ->> 'signups')::int = 3, 'and today''s sign-ups');
select t.ok((public.admin_stats(7) -> 'days' -> 6 ->> 'uploads')::int = 1, 'and today''s uploads that did not fail');
select t.is(jsonb_array_length(public.admin_stats(7) -> 'days'), 7, 'one row per day');
select t.ok(jsonb_array_length(public.admin_log_page()) >= 20, 'every admin action above is in the audit log');
select t.is(public.admin_log_page(1) -> 0 ->> 'action', 'account.unban', 'newest first');
select t.is(public.admin_log_page(1) -> 0 -> 'actor' ->> 'username', 'owner', 'with who did it');
select t.is(public.admin_log_page(1) -> 0 ->> 'target_name', '@bea', 'and a readable target');

-- Deleting ----------------------------------------------------------------------------------

select t.login(:cal);
select t.is(t.err(format($$select public.delete_video(%L)$$, :clip)), 'not_found', 'only the owner deletes a clip');
select t.login(:bea);
select public.delete_video(:clip);
reset role;
select t.is((select count(*)::int from public.storage_cleanup where video_id = :clip), 2, 'a deleted clip queues its two storage folders');
select t.is((select count(*)::int from public.comments), 0, 'its comments are gone');
select t.worker();
select t.ok((select count(*) >= 2 from public.claim_cleanup('test-worker')), 'the worker claims the cleanup');
reset role;

-- Every table has row level security ----------------------------------------------------------

select t.is(
  (select coalesce(string_agg(c.relname, ', '), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  '', 'every table in public has row level security on');

-- No function is left open by accident: everything anon can call is on this list.
select t.is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
      and p.proname not in (
        'is_admin', 'is_banned', 'session_status', 'username_available', 'username_is_valid', 'video_is_visible',
        'video_comments', 'feed_page', 'video_by_id', 'profile_page', 'record_view',
        'hashtag_page', 'search_all', 'discover_page', 'follow_list', 'comment_replies',
        'video_extension_for', 'clean_hashtags', 'encode_max_attempts', 'encode_stale_after')),
  '', 'visitors can call only the functions meant for them');

select 'ALL PASSED' as result;
