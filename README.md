# YapTok

<p align="center">
  <img src="docs/screenshots/desk-feed.webp" alt="The YapTok feed on a desktop: one vertical clip, the action buttons beside it" width="720">
</p>

<p align="center">
  Short vertical videos. Swipe up for the next one. Built in the open, one feature at a time.
</p>

> [!IMPORTANT]
> **This is source code, not an app you can sign up for.** There is no official
> YapTok website yet. If you want to try it, run your own copy: see
> [Quick start](#quick-start).

YapTok is a short video app: a full screen "For You" feed you swipe through,
likes, comments, follows, sharing, creator pages, upload from a phone or a
desk, and an admin panel where the owner switches features on and off without
a deploy. It is an independent project with its own name, mark and look (see
[NOTICE.md](NOTICE.md)).

Built with Next.js 16, React 19, Tailwind 4, zustand and Supabase (Postgres and
Auth). Clips live on Cloudflare R2, a small ffmpeg worker turns uploads into
HLS, and hls.js plays them. Dark by default, with a light theme.

| The feed | Comments | A creator page |
| --- | --- | --- |
| ![A clip playing full screen on a phone with the action rail on the right](docs/screenshots/phone-feed.webp) | ![The comment drawer open over a clip](docs/screenshots/phone-comments.webp) | ![A creator page with counts and a grid of clips](docs/screenshots/phone-profile.webp) |

| Upload | Processing | No clips or no database |
| --- | --- | --- |
| ![The upload form: preview, cover frame slider, caption, hashtags](docs/screenshots/phone-upload-form.webp) | ![The page following the encoder after the upload](docs/screenshots/phone-upload-processing.webp) | ![The empty state that says database not connected](docs/screenshots/empty-phone.webp) |

The admin panel:

| Feature toggles | Site settings |
| --- | --- |
| ![Every feature flag with Off, Test and Everyone, and who changed it](docs/screenshots/admin-flags.webp) | ![Upload limits, who can upload, comments, sign-ups and the banner](docs/screenshots/admin-settings.webp) |

| Reports | Accounts | Stats |
| --- | --- | --- |
| ![The queue of reported clips and comments](docs/screenshots/admin-reports.webp) | ![Accounts with ban, verify and invite](docs/screenshots/admin-accounts.webp) | ![Totals and sign-ups, uploads and views per day](docs/screenshots/admin-stats.webp) |

Everything in the screenshots is made up: invented accounts and test pattern
clips from `npm run stack -- --seed`.

## Status, honestly

- This is the first session's foundation. What is listed under
  [What works](#what-works) was run in a real browser against a real
  PostgreSQL with the real migrations and the real encoder worker, on one
  machine. It has **not** yet run on Supabase or on Cloudflare R2: there is no
  YapTok project there yet. The stand in used instead is described in
  [docs/features.md](docs/features.md#local-stack).
- It is built for a video series and as a learning resource, not as a hardened
  product. It has unit tests, SQL tests of every access rule and a smoke test,
  but it has not been through a security audit and has not run at scale.
- Every feature is behind a flag. On a new database all of them start switched
  off except accounts and the admin panel, so you choose what is live.
- The app runs without a database and says "database not connected".

## What works

- **Feed**: full screen vertical player; swipe, wheel, arrow keys, `j`/`k`;
  autoplay with a sound button; the next clip is buffered before you get to
  it; like, comment drawer, share, follow; a clear empty state.
- **Creator pages** at `/@username` with counts, follow and a grid of clips.
- **Upload**: pick a video (or record one), caption, hashtags, cover frame,
  public or private; multipart upload straight to storage with progress and
  cancel; the page follows the encoder until the clip is live.
- **Admin panel** at `/admin`, only for accounts in the `admins` table:
  feature toggles (off / test / everyone, search, who changed it and when),
  site settings (upload limits, who can upload, comments, sign-ups, a banner),
  reports queue, remove and restore clips, ban and unban accounts, verify and
  invite, an audit log of every admin action, and a stats page.
- **Checked in the database**: no table can be written through the API. Every
  write is a function that checks the caller, and every admin function
  refuses anyone who is not an admin. 141 SQL checks hold this in place.

## Not built yet

Search, hashtag pages, sounds, a ranked feed (it is newest first), profile
pictures, notifications, sign in with other accounts, creator analytics, and
the legal pages. Their flags are already in the panel, switched off.

Known limits of what is built: a signed out visitor's view is counted by a key
their browser keeps, so a determined visitor could count twice; creator and
clip pages that do not exist show the "not found" page but, because pages
stream, with status 200; "Test" mode lists the admin who pressed it, there is
no screen yet for adding other testers.

## Quick start

You need [Node.js 22](https://nodejs.org/) with npm.

```bash
git clone https://github.com/myfilehero/yaptok.git
cd yaptok
npm ci
cp .env.example .env.local   # leave it empty for now
npm run dev                  # http://localhost:3000, "database not connected"
```

`/admin` shows a read only preview with made up rows in this mode.

To click around a filled site, with a local PostgreSQL (15 or newer) and
ffmpeg installed, and no accounts anywhere:

```bash
export DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres
npm run stack -- --reset --seed      # prints the lines for .env.local, keeps running
npm run dev                          # in a second terminal
```

Sign in as `owner@example.com` (the admin) or `mira@example.com`, password
`yaptok-local`. To try a real upload, also start the encoder with the two
extra lines the stack printed: `node worker/index.mjs`.

## Run it yourself

1. **Database.** Make a [Supabase](https://supabase.com) project. In its SQL
   editor paste [`supabase/yaptok-all-migrations.sql`](supabase/yaptok-all-migrations.sql)
   and run it. Details: [supabase/migrations/README.md](supabase/migrations/README.md).
2. **Settings.** Put the project URL and the publishable key in `.env.local`
   (see `.env.example`).
3. **First admin.** Sign up on your site, then in the SQL editor:
   ```sql
   insert into public.admins (user_id, note)
   select id, 'owner' from auth.users where email = 'you@example.com';
   ```
4. **Switch features on** at `/admin`: start with For You feed and Creator pages.
5. **Uploads.** Make a Cloudflare R2 bucket, add the four `R2_` settings, set
   up the encoder box ([ops/encoder/README.md](ops/encoder/README.md)), then
   switch on Upload and Processing.
6. **A server.** [ops/app/README.md](ops/app/README.md) takes you from nothing
   to your own domain.

How each feature works: [docs/features.md](docs/features.md). What is built and what comes next: [docs/roadmap.md](docs/roadmap.md).

## Checks

```bash
npm run typecheck
npm run lint                 # also scans for secrets
npm test                     # unit tests
npm run db:test              # the SQL rules, on a local PostgreSQL (DATABASE_URL)
rm -rf .next && npm run build
npx next start -p 3123 &
node scripts/smoke.mjs http://localhost:3123
npm ci --prefix worker && node --test worker/
```

## License

MIT, see [LICENSE](LICENSE). YapTok started from parts of SlopTube by the same
owner; [NOTICE.md](NOTICE.md) says which.
