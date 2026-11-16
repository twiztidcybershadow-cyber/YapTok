# Features

How each part works and where its code is. Start with the quick start in the
[README](../README.md).

## Feature flags

Every feature checks a row in the `feature_flags` table:

| Mode | Who sees the feature |
| --- | --- |
| Off | nobody |
| Test | only the listed testers. Pressing Test adds you |
| Everyone | everybody |

Flip them at **/admin**. A change counts from the next page load of every
visitor: nothing is built into the app, so there is no deploy. The switch is
also checked inside the database functions, so a feature that is off cannot be
used by calling the API by hand either.

In code: `flagOn("key")` from `lib/flags.ts` on the server, `useFlag("key")`
from `lib/store/session.ts` in the browser.

| Flag | What it switches | Starts |
| --- | --- | --- |
| `accounts` | Sign up, sign in, settings | everyone |
| `admin` | The admin panel (cannot be switched off from the panel itself) | everyone |
| `feed` | The For You feed and `/v/<id>` | off |
| `profiles` | Creator pages at `/@username` | off |
| `upload` | The upload page | off |
| `record` | The Record button on the upload page | off |
| `processing` | The encoder worker picks up uploads | off |
| `likes`, `comments`, `follows`, `share` | The buttons on a clip | off |
| `gestures` | Double tap to like, hold to pause, hold the right side for double speed | off |
| `scrub` | Drag the bar at the bottom of a clip | off |
| `following` | The Following feed at `/following` and the switch on top of the feed | off |
| `messages` | Direct messages: text, and sending a clip from the share sheet | off |
| `inbox` | The Inbox page: likes, comments, replies, new followers, with a dot for what is new | off |
| `comment_threads` | Reply to a comment and like comments | off |
| `follow_lists` | Followers and Following on a profile open the lists | off |
| `saves` | The bookmark on a clip, and the Liked and Saved tabs on your own profile | off |
| `reports` | Report a clip or a comment | off |
| `hashtags` | Hashtag pages at `/tag/<name>`; hashtags on a clip become links | off |
| `search` | Search for people, hashtags and clips at `/search` | off |
| `discover` | Popular hashtags, creators and clips on `/search` before you type | off |
| `sounds` | Not built yet (later session) | off |

## The feed

`/` is one clip at a time, full screen. Swipe up or down on a phone; on a desk
use the wheel, the arrow keys, `j` and `k`, or the two buttons. `space` plays
or pauses, `m` is sound, `l` likes, `c` opens the comments.

- Only three clips are in the page at any time: the one playing, the next one
  (its stream already open and buffering, so the swipe starts at once) and the
  cover of the previous one.
- Browsers only autoplay without sound, so the first visit starts muted. The
  sound button turns it on for every clip after that, and the choice is
  remembered on that device. If the browser still refuses sound before a tap,
  the clip starts muted instead of not starting.
- With the `gestures` flag: a double tap likes (it never takes a like back), a
  held finger pauses, and a finger held on the right third plays at double
  speed until it lifts. A single tap then waits a quarter of a second before
  it pauses, to see whether a second tap comes.
- With the `scrub` flag the bar at the bottom can be dragged, or moved with
  the left and right arrow keys when it has focus.
- A view counts after two seconds on a clip, once per viewer, clip and day.
- The next page of eight clips is fetched three clips before the end.
- When there is nothing to play, the same stage says why: database not
  connected or no clips yet.

A feature that is off leaves no trace for visitors: its link is not in the
navigation, its page is "page not found", and with the feed off the home page
is the mark alone.

With the `following` flag a switch sits on top of the feed: For You, or
Following (`/following`), which is the same player over the clips of the
creators you follow. With the `saves` flag every clip has a bookmark; saved
and liked clips are listed on two tabs of your own profile that only you see.

Every rule is a small pure function in `lib/feed/nav.ts` with tests in
`tests/feed.test.mjs`; `components/feed/Feed.tsx` only connects them to the
page. The order is newest first for now. A ranked feed only has to change
`feed_page()` in `007_feed.sql`.

## Finding things

`/search` is one page: before you type it shows what is popular (trending
hashtags of the last 30 days, creators by followers, clips by views this
week); with a query it shows people, hashtags and clips. The box is a plain
form, so a search has an address you can share. `/tag/<name>` lists every clip
with that hashtag. Matching is simple for now (the start of a username, a
caption that contains the text); a text index is a later migration. Code:
`013_discover.sql`, `lib/discover/`, `components/discover/`.

## Upload

`/upload`: choose a video (or record one, behind the `record` flag), write a
caption and hashtags, slide to the cover frame, pick who can see it, post.

1. `POST /api/upload/sign` checks the file against the owner's limits, calls
   `create_upload()` (which checks everything again in the database) and
   answers one presigned URL per 16 MB part.
2. The browser sends the parts straight to R2, three at a time, with retries.
3. `POST /api/upload/complete` joins the parts, checks the size and marks the
   clip `uploaded`, which queues an encode job.
4. The page polls `/api/videos/<id>/status` and shows the encoder's progress
   until the clip is live.

The encoder worker (`worker/`, set up with `ops/encoder/README.md`) makes HLS in
up to three sizes, the cover at the frame the creator picked, and a preview
sprite. It measures the real length and fails a clip that is longer than the
limit, whatever the browser said.

## The admin panel

`/admin` only exists for accounts in the `admins` table. Everyone else gets
the plain 404 page. Three locks, from outside in: `proxy.ts`, the page's own
`adminGate()`, and `require_admin()` at the top of every admin function in the
database. The third one is the one that counts: the tables behind the panel
cannot be read or written through the API at all.

An admin can also open it from any page with Ctrl+Shift+S (Cmd+Shift+S on a
Mac). The keys do nothing for anyone else.

| Tab | What you can do |
| --- | --- |
| Features | Every flag with Off / Test / Everyone, a search box, who changed it and when |
| Settings | Longest clip, biggest file, uploads per day, who can upload (everyone, verified, invited), comments on or off, sign-ups open or closed, a banner line for the top of every page |
| Reports | Reported clips and comments, oldest first: remove what was reported or dismiss the report |
| Clips | Search every clip, remove one from the site, restore it |
| Accounts | Search accounts, ban and unban, verify, invite to upload |
| Log | Every admin action, newest first, written by the database |
| Stats | Totals, what is waiting, and sign-ups, uploads and views per day |

Settings are rows in `site_settings`. The database reads the same rows when it
checks an upload, a comment or a sign-up, so a change counts from the next
request.

Without a database, `npm run dev` shows the panel with made up rows (read
only), so it can be looked at before Supabase is connected. A production build
hides it.

### Making the first admin

In the Supabase SQL editor (there is no button for this on purpose):

```sql
insert into public.admins (user_id, note)
select id, 'owner' from auth.users where email = 'you@example.com';
```

## What a ban does

A banned account is signed out on its next page, cannot sign back in to do
anything (every function refuses it), and its clips and comments drop out of
every list until it is unbanned. Nothing is deleted.

## Local stack

To show the demo on a phone on the same Wi-Fi, add `--host` with this
computer's address (see the top of `scripts/local-stack.mjs`).

`npm run stack -- --reset --seed` starts a small stand in for Supabase and R2
on top of a local PostgreSQL with the real migrations (see the top of
`scripts/local-stack.mjs`). It is how the screenshots were taken and how the
upload was tried end to end with the real encoder worker. It is a development
tool: it is not Supabase, and it never runs in production.
