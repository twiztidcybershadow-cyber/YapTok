# YapTok

A short vertical video app built in the open, one feature per session: a full
screen swipe feed, likes, comments, follows, creator pages, upload, and an admin
panel that switches features on and off.
Owner: Antic. Sessions are filmed, so keep the structure clean and docs readable.

@AGENTS.md

## Stack (decided, do not change)

- Next.js 16 (App Router, TypeScript, Tailwind v4, Cache Components on). Read
  `node_modules/next/dist/docs/` before using a Next API: it differs from older versions.
- React 19, zustand for client state (`lib/store/`)
- Supabase (Postgres + Auth). Clients: `lib/supabase/client.ts` (browser) and
  `lib/supabase/server.ts` (server, cookies). Both return `null` when the settings are
  missing; the UI must keep working and show "database not connected".
- Supabase settings are read at request time on the server (`lib/supabase/env.ts`),
  never frozen into the build, so one Docker image works everywhere.
- Cloudflare R2 for files, hls.js for playback, the encoder worker in `worker/`
- Our own look: dark by default with a light theme toggle, Roboto, colors as CSS
  variables in `app/globals.css`, the brand in `lib/brand.ts`. Phone first. Node 22, npm.
- Every feature ships behind a row in `public.feature_flags`: `flagOn(key)` from
  `lib/flags.ts` on the server, `useFlag(key)` from `lib/store/session.ts` in the browser.
  The owner flips them at `/admin`.
- The project is open source (MIT): no secrets, no real user data, no internal hostnames.

## How the code is laid out

- `app/` pages and API routes. A page is a thin shell: a `<Suspense>` around one
  async component that asks a `lib/*/server.ts` function what to show.
- `components/` by area: `feed/`, `profile/`, `upload/`, `admin/`, `auth/`, `shell/`.
- `lib/` by area. Rules live in files with no imports (`lib/feed/nav.ts`,
  `lib/upload/rules.ts`, `lib/admin/types.ts`) so `node --test` loads them directly.
- Everything the app writes goes through a database function (`supabase/migrations/`).
  The browser calls them with `callRpc` from `lib/social/client.ts`; the function
  checks the flag, the ban and the rules itself. Never add a table write policy.
- Admin: `/admin` is hidden by `proxy.ts`, checked again by `adminGate()` in
  `lib/admin/server.ts`, and every admin function starts with `require_admin()`.
  Every admin action writes `admin_log`.

## Run it

```bash
npm install
cp .env.example .env.local   # leave it empty: "database not connected"
npm run dev                  # http://localhost:3000
```

With data, on a local PostgreSQL (no Supabase project needed):

```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres npm run stack -- --reset --seed
# put the lines it prints in .env.local, then: npm run dev
```

## Checks before any push

All of these must pass:

```bash
npm run typecheck
npm run lint                 # also scans for secrets (scripts/check-secrets.mjs)
npm test                     # node:test unit tests in tests/
npm run db:test              # the SQL rules on a local PostgreSQL (DATABASE_URL)
rm -rf .next && npm run build
npx next start -p 3123 &
node scripts/smoke.mjs http://localhost:3123
```

Worker changes also need: `npm ci --prefix worker && node --test worker/`

If Docker is available, also: `docker build -f ops/app/Dockerfile .` and
`docker build -f ops/encoder/Dockerfile worker/`

## Rules

- Every new feature on its own branch. Never push `main`. Shipping is `main` to `release`
  and is done by the owner.
- Database changes go in `supabase/migrations/` as the next numbered file, re-runnable
  (`if not exists`, `create or replace`, `drop policy if exists`), RLS on every table.
  Never edit an applied migration. After adding one, refresh
  `supabase/yaptok-all-migrations.sql` and add checks to `supabase/tests/rules.test.sql`.
  See `supabase/migrations/README.md`.
- A new feature gets a flag row (seeded `off`) in its migration, and a new owner
  setting gets a row in `site_settings`: both then show up in `/admin` by themselves.
- No em dashes in UI text or docs.
- The name, the mark and the palette are our own (`lib/brand.ts`; redraw the favicon
  with `node scripts/favicon.mjs`). Never use another app's name, logo, colors, icons,
  sounds or wording, anywhere: UI, comments, flags, docs. A test checks for names.
- Never commit secrets. `.env.local` is gitignored; only `.env.example` is committed.
- Deploy files live in `ops/app/` (Dockerfile, compose, install.sh) and
  `ops/encoder/` for the encoder box. Keep each README in step with its files.
