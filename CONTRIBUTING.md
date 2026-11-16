# Contributing to YapTok

Thanks for wanting to help. YapTok is a short vertical video app: a full
screen swipe feed, likes, comments, follows, upload and an admin panel. It is
open source under the MIT license.

Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first. Security problems
are reported privately, see [SECURITY.md](SECURITY.md).

## Run it

You need Node 22 and npm.

```bash
npm install
cp .env.example .env.local   # optional: fill in your Supabase and R2 settings
npm run dev                  # http://localhost:3000
```

With nothing filled in the app still runs and shows "database not connected".
To set up a database, run the files in `supabase/migrations/` in order, or
make one file and paste it into the Supabase SQL editor:

```bash
npm run db:migrations > all-migrations.sql
```

## Before you open a pull request

All of these must pass. CI runs the same checks.

```bash
npm run typecheck
npm run lint                 # also scans for secrets
npm test
rm -rf .next && npm run build
npx next start -p 3123 &
node scripts/smoke.mjs http://localhost:3123
```

If you changed something in `supabase/`, also run the SQL tests against a
local Postgres 16. The script makes its own throwaway database on that server
and drops it at the end:

```bash
DATABASE_URL=postgresql://postgres@localhost:5432/postgres node scripts/db-test.mjs
```

If you changed something in `worker/` (it needs ffmpeg on the PATH):

```bash
npm ci --prefix worker && node --test worker/
```

If you have Docker, also check that both images build:

```bash
docker build -f ops/app/Dockerfile .
docker build -f ops/encoder/Dockerfile worker/
```

## Rules

- One change per branch and pull request. Never push to `main` or `release`.
- Every new feature ships behind a row in `public.feature_flags`. Check it
  with `flagOn(key)` on the server and `useFlag(key)` in the browser. The
  owner switches features on in the admin panel at `/admin`.
- Database changes go in `supabase/migrations/` as the next numbered file.
  Make it safe to run twice (`if not exists`, `create or replace`,
  `drop policy if exists`) and switch on row level security for every table.
  Never edit a migration that has already been applied.
- No secrets, no real user data, no real email addresses (use `example.com`),
  no internal hostnames and no public IP addresses. Keys live in `.env.local`,
  which is gitignored. Only `.env.example` is committed.
- Keep the docs in step: if a setting or a setup step changes, update
  `.env.example`, `worker/.env.example` and the READMEs in `ops/`.
- Write in plain, simple English. No em dashes in UI text or docs.

## Reporting bugs and ideas

Open an [issue](https://github.com/myfilehero/yaptok/issues) and pick the bug
report or feature idea form. Leave out keys, passwords and other people's
personal data.
