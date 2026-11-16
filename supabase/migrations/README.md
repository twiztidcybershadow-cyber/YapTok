# Database migrations

Every change to the database is a numbered SQL file in this folder. They run
in order, lowest number first.

| File | What it adds |
| --- | --- |
| `000_init.sql` | A shared helper (`touch_updated_at`) |
| `001_feature_flags.sql` | `feature_flags`: one row per feature, off / test / everyone |
| `002_admin.sql` | `admins`, the audit log, `site_settings`, and the functions that change a flag or a setting |
| `003_profiles.sql` | `profiles` (one per account, also the creator page), sign up, bans |
| `004_videos.sql` | `videos` (clips) and the upload functions, with the limits read from the site settings |
| `005_processing.sql` | The encode queue for the worker, and the storage cleanup queue |
| `006_social.sql` | Likes, follows and comments |
| `007_feed.sql` | The For You feed, creator pages, view and share counts |
| `008_moderation.sql` | Reports, and the admin actions: remove, restore, ban, unban, verify, invite |
| `009_admin_panel.sql` | What the pages under `/admin` read: lists, the log, the stats |
| `017_messages.sql` | Direct messages: text, and sending a clip |
| `016_inbox.sql` | The activity inbox and the triggers that fill it |
| `015_comment_threads.sql` | Replies to comments and likes on comments |
| `014_follow_lists.sql` | The follower and following lists of a profile |
| `013_discover.sql` | Hashtag pages, search and the Discover page |
| `012_saves.sql` | Saving clips, and the Liked and Saved lists |
| `011_following.sql` | The Following feed |
| `010_player.sql` | Flags for the player's touch controls (double tap, hold, scrub bar) |

## On a new Supabase project

The quickest way: open the
[SQL editor](https://supabase.com/dashboard/project/_/sql/new), paste the whole
of [`../yaptok-all-migrations.sql`](../yaptok-all-migrations.sql) (every file
above, in order) and press Run.

Or, with the PostgreSQL client installed and the connection string from the
project's Connect page:

```bash
npm run db:migrations -- --apply "postgresql://..."
```

Then make yourself the first admin. There is no button for this on purpose:
nobody can become an admin through the app.

```sql
insert into public.admins (user_id, note)
select id, 'owner' from auth.users where email = 'you@example.com';
```

Sign in, open `/admin` and switch the features on.

## Rules

- A new change is a new file with the next number. Never edit a file that has
  already been run on a real project.
- Every file is safe to run again: `create table if not exists`,
  `create or replace function`, `drop policy if exists` before `create policy`,
  `on conflict do nothing` for seed rows.
- Every table has row level security switched on, and no table can be written
  through the API directly. Writes go through functions that check who is
  asking. A test fails if a table is added without row level security, or if a
  function is left open to visitors by accident.
- Functions are `security definer` with `set search_path = ''`, and every name
  inside them is written with its schema.
- After adding a file, refresh the single file and run the tests:

```bash
npm run -s db:migrations > supabase/yaptok-all-migrations.sql
npm run db:test          # needs a local PostgreSQL, see ../tests
```

## Tests

`supabase/tests/rules.test.sql` checks the rules against a real PostgreSQL as
the three API roles (visitor, signed in, the worker): who can read what, who
can call what, and that every admin function refuses anyone who is not in the
`admins` table. `npm run db:test` makes a throwaway database, runs every
migration twice, runs the checks and drops the database again.

`supabase/tests/shim.sql` is what a plain PostgreSQL needs to look like a
Supabase project for these tests (the roles, `auth.users`, `auth.uid()`).
Never run it on Supabase.
