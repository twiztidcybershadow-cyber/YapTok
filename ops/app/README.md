# Put YapTok on the internet

This guide takes you from nothing to YapTok running on your own domain.
It takes about 40 minutes. You need:

- a [Supabase](https://supabase.com/dashboard) account (the database and sign in)
- a [Cloudflare](https://dash.cloudflare.com/) account, with your domain using
  Cloudflare for DNS (R2, the file storage, is part of Cloudflare)
- a [Hetzner Cloud](https://console.hetzner.cloud/) account (the server)
- a copy of this repository on GitHub, and on your own computer with Node 22

How it works once it is set up: you push `main` to the `release` branch, GitHub builds a
Docker image, and the server checks for a new image every 5 minutes and switches to it
without downtime.

Clips also need the encoder box. Set it up after this guide:
[`ops/encoder/README.md`](../encoder/README.md).

---

## 1. Set up the database

1. In the [Supabase dashboard](https://supabase.com/dashboard) click **New project**
   and wait until it is ready.
2. On your own computer, in the YapTok folder, make one SQL file with every migration
   in order:

   ```bash
   npm install
   npm run db:migrations > all-migrations.sql
   ```

3. Open the [SQL editor](https://supabase.com/dashboard/project/_/sql/new), paste the
   whole contents of `all-migrations.sql` and click **Run**.

You can also run the files in `supabase/migrations/` one at a time, in order, from
`000` to `009`. The result is the same.

Keep two values from the [API keys page](https://supabase.com/dashboard/project/_/settings/api-keys)
at hand for step 6: the **Project URL** and the **Publishable key**. Both are public by
design.

## 2. Make the storage bucket

Clips are stored in Cloudflare R2.

1. Open [R2](https://dash.cloudflare.com/?to=/:account/r2/overview) in the Cloudflare
   dashboard and click **Create bucket**. Pick a name, for example `yaptok-media`.
   Leave public access off.
2. Copy the **Account ID** from the R2 overview page.
3. Open [Manage R2 API Tokens](https://dash.cloudflare.com/?to=/:account/r2/api-tokens)
   and click **Create API token**. Permission: **Object Read & Write**, on this bucket
   only. Copy the **Access Key ID** and the **Secret Access Key**. The secret is shown
   only once.
4. Open the bucket, then **Settings**, then **CORS Policy**, and add this rule with
   your own domain in it. Browsers upload straight to the bucket and play clips from
   it, and this rule lets them:

   ```json
   [
     {
       "AllowedOrigins": ["https://yaptok.example.com"],
       "AllowedMethods": ["GET", "HEAD", "PUT"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

Cloudflare docs: [Create buckets](https://developers.cloudflare.com/r2/buckets/create-buckets/),
[API tokens](https://developers.cloudflare.com/r2/api/tokens/),
[Configure CORS](https://developers.cloudflare.com/r2/buckets/cors/)

## 3. Create the server

1. Open the [Hetzner Cloud console](https://console.hetzner.cloud/) and pick (or create) a project.
2. Click **Add Server**.
3. Location: **Helsinki**.
4. Image: **Ubuntu 24.04**.
5. Type: **CX23** (shared vCPU, x86).
6. SSH key: add your public key. If you do not have one yet, follow
   [GitHub's guide to creating an SSH key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent).
7. Click **Create & Buy now** and copy the server's **IPv4 address**.

Hetzner docs: [Creating a server](https://docs.hetzner.com/cloud/servers/getting-started/creating-a-server/)

## 4. Point your domain at the server

1. Open [Cloudflare](https://dash.cloudflare.com/), pick your domain, then **DNS** and **Records**.
2. Click **Add record**:
   - Type: **A**
   - Name: `@` for the bare domain, or a subdomain like `yaptok`
   - IPv4 address: the server IP from step 3
   - Proxy status: **Proxied** (orange cloud on)
3. Save.
4. Go to **SSL/TLS** and **Overview**, and set the encryption mode to **Full**.

Cloudflare docs: [Create DNS records](https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/),
[SSL modes](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full/)

## 5. Log in to the server

Replace `YOUR_SERVER_IP` with the address from step 3:

```bash
ssh root@YOUR_SERVER_IP
```

Type `yes` if it asks about the fingerprint.

## 6. Create the settings file

Make the folder:

```bash
mkdir -p /opt/yaptok
```

Open the settings file in an editor:

```bash
nano /opt/yaptok/.env
```

Paste this, and put your own values after each `=`:

```bash
DOMAIN=yaptok.example.com
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key_here
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
```

Save with `Ctrl+O`, `Enter`, then quit with `Ctrl+X`.

What each line is:

| Name | What it is |
| --- | --- |
| `DOMAIN` | Your domain, without `https://`. Only the installer reads it, to set up the web server. |
| `NEXT_PUBLIC_SUPABASE_URL` | The **Project URL** from step 1 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The **Publishable key** from step 1 |
| `R2_ACCOUNT_ID` | The **Account ID** from step 2 |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | The API token from step 2 |
| `R2_BUCKET` | The bucket's name from step 2 |

The R2 secret is a real secret. It lives only in this file: never in the repository
and never in a chat. The installer makes the file readable by root only.

Without the two Supabase lines the site still runs and shows "database not
connected". Without the four R2 lines people cannot upload or play clips.

Optional: `MEDIA_PUBLIC_URL=https://media.example.com`. If you connect a
[custom domain to the bucket](https://developers.cloudflare.com/r2/buckets/public-buckets/),
put it here and the player loads clips straight from that domain instead of through
`/api/media`. Know what it means first: everything under `hls/` in the bucket is then
public to anyone who has the link, private clips included. Leave it out if you are
not sure. If you set it, set the same value on the encoder box.

Sign in needs one more setting in Supabase. Open
[URL Configuration](https://supabase.com/dashboard/project/_/auth/url-configuration),
set **Site URL** to `https://yaptok.example.com` (your domain) and add
`https://yaptok.example.com/auth/callback` to the **Redirect URLs**.

## 7. Let the server download the image

The image lives in the GitHub Container Registry. Pick **one** of these:

**Option A (simplest): make the package public.** After the first build (step 9) open
[the package settings](https://github.com/users/myfilehero/packages/container/yaptok/settings)
(for an organization: `https://github.com/orgs/myfilehero/packages/container/yaptok/settings`),
scroll to **Danger Zone**, and change visibility to **Public**. Nothing to do on the server.

**Option B: log the server in.** Create a
[classic personal access token](https://github.com/settings/tokens/new?scopes=read:packages&description=yaptok%20server)
with only the `read:packages` scope, then run this on the server and paste the token when it asks for a password:

```bash
docker login ghcr.io -u YOUR_GITHUB_USERNAME
```

(Docker is installed in step 8, so run this command after step 8 if you pick option B.)

## 8. Run the installer

Open the installer in an editor on the server:

```bash
nano /root/install.sh
```

Paste the whole contents of
[`ops/app/install.sh`](https://github.com/myfilehero/yaptok/blob/main/ops/app/install.sh)
(on GitHub, click **Copy raw file**), save with `Ctrl+O`, `Enter`, and quit with `Ctrl+X`.

Run it:

```bash
bash /root/install.sh
```

It installs Docker and Caddy, sets up the web server for your domain, and installs the
automatic updater. It is fine to run it again later.

If you already have the repo on your own computer, you can copy the file instead of pasting it:

```bash
scp ops/app/install.sh root@YOUR_SERVER_IP:/root/install.sh
```

## 9. Ship it

On your own computer, in the YapTok repo:

```bash
git push origin main:release
```

Watch the build on the [Actions tab](https://github.com/myfilehero/yaptok/actions).
When it is green, wait up to 5 minutes and open your domain.

## 10. Make yourself the admin and switch features on

1. Open your domain and sign up with your own email address.
2. In the [SQL editor](https://supabase.com/dashboard/project/_/sql/new) run this,
   with the address you signed up with:

   ```sql
   insert into public.admins (user_id, note)
   select id, 'owner' from auth.users where email = 'you@example.com';
   ```

3. Open `https://yaptok.example.com/admin` (your domain). The first page lists every
   feature with a three way switch: **Off**, **Test** (only you and the testers you
   list) and **Everyone**.

A new site starts with only accounts and the admin panel on. Switch on what you
want, for example the feed, upload, processing, likes, comments, follows, profiles,
share and reports. Try a feature on **Test** first if you like. A few switches are
for features that are not built yet: leave those off.

The other admin pages hold the site settings (the longest clip, the biggest file,
uploads per day, who can upload, and more), the report queue, accounts, clips, the
log of admin actions and the stats.

Uploads stay in line until the encoder box is running and **Processing** is on. Set
the box up now: [`ops/encoder/README.md`](../encoder/README.md).

---

## Day to day

Ship a new version:

```bash
git push origin main:release
```

See what the updater did (on the server):

```bash
tail -n 50 /var/log/yaptok-update.log
```

Run an update right now instead of waiting:

```bash
systemctl start yaptok-update
```

Check which version is live (on your computer):

```bash
curl https://yaptok.example.com/api/version
```

Change a setting: edit `/opt/yaptok/.env`, then restart the running copy:

```bash
nano /opt/yaptok/.env
```

```bash
cd /opt/yaptok && PORT=$([ "$(cat active)" = green ] && echo 3001 || echo 3000) docker compose -p yaptok-$(cat active) up -d --force-recreate
```

A new version with database changes: run only the new files from
`supabase/migrations/` in the SQL editor before you push to `release`. For example,
`npm run db:migrations -- --from 010 > new-migrations.sql` makes one file with
everything from `010` on.

## How the updater works

Every 5 minutes `yaptok-update` pulls `ghcr.io/myfilehero/yaptok:latest`. If the image
changed, it starts the new version next to the old one (blue on port 3000, green on 3001),
waits until `/api/health` answers, points Caddy at the new one, and stops the old one.
If the new version never gets healthy, the old one keeps serving and the log says why.

Files on the server:

| Path | What it is |
| --- | --- |
| `/opt/yaptok/.env` | Your settings |
| `/opt/yaptok/docker-compose.yml` | How the container runs |
| `/opt/yaptok/active` | Which color is live (`blue` or `green`) |
| `/etc/caddy/Caddyfile` | Web server config for your domain |
| `/etc/caddy/yaptok-upstream.caddy` | Which port Caddy sends traffic to |
| `/usr/local/bin/yaptok-update` | The updater |
| `/etc/systemd/system/yaptok-update.service`, `yaptok-update.timer` | Run the updater every 5 minutes |
| `/etc/logrotate.d/yaptok-update` | Keeps 8 weeks of the updater's log |
| `/var/log/yaptok-update.log` | The updater's log |

## Files in this folder

- `Dockerfile`: the app image (Node 22, the Next.js standalone build, runs as an
  unprivileged user, health check on `/api/health`). Built from the repo root.
- `docker-compose.yml`: the service, bound to `127.0.0.1` only, with log limits.
  The installer writes the same file to `/opt/yaptok/docker-compose.yml`.
- `install.sh`: the installer from step 8
- `../../.github/workflows/build.yml`: builds and pushes the image on push to `release`
