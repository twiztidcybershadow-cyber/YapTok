# Set up the encoder box

The encoder turns uploaded clips into something people can stream: HLS at
360p, 720p and 1080p (only the sizes the upload can fill), three cover images
and a preview sprite. It runs on its own server, separate from the website,
because encoding keeps every CPU core busy.

It takes about 15 minutes. Do the website first
([`ops/app/README.md`](../app/README.md)): the database and the R2 bucket are made
there. You need:

- a [Hetzner Cloud](https://console.hetzner.cloud/) account
- the Supabase **secret key** (service role) from the
  [API keys page](https://supabase.com/dashboard/project/_/settings/api-keys)
- the R2 bucket the website uploads to, and an R2 API token for it
- the database migrations applied (step 1 of the website guide)

How it works once it is set up: the worker asks the database for a job every
5 seconds. When someone finishes an upload it downloads the file from R2,
encodes it, uploads the result to `hls/<video id>/` in the same bucket and marks
the clip ready. One clip at a time. When you push `main` to `release` and the
worker code changed, GitHub builds a new image and the box switches to it within
5 minutes, but never in the middle of an encode.

---

## 1. Create the server

1. Open the [Hetzner Cloud console](https://console.hetzner.cloud/) and pick your project.
2. Click **Add Server**.
3. Location: the same as the website, for example **Helsinki**.
4. Image: **Ubuntu 24.04**.
5. Type: **CPX31** (4 shared vCPU, 8 GB memory, 160 GB disk). Shared vCPU is fine
   for this.
6. SSH key: add your public key. No key yet? Follow
   [GitHub's guide to creating an SSH key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent).
7. Click **Create & Buy now** and copy the server's **IPv4 address**.

The encoder only makes outgoing connections (to Supabase and R2), so it needs no
domain and no open ports besides SSH.

Hetzner docs: [Creating a server](https://docs.hetzner.com/cloud/servers/getting-started/creating-a-server/)

**How fast is it?** Encoding takes roughly as long as the clip itself, a bit more
for busy footage. Clips are short (60 seconds at most unless you change it at
`/admin/settings`), so most are ready within a minute or two of the upload. Jobs
wait in line, so a busy day means a longer wait, not errors. Every job stops
after 2 hours at the latest.

## 2. Log in to the server

Replace `YOUR_SERVER_IP` with the address from step 1:

```bash
ssh root@YOUR_SERVER_IP
```

Type `yes` if it asks about the fingerprint.

## 3. Create the settings file

```bash
mkdir -p /opt/yaptok-encoder
nano /opt/yaptok-encoder/.env
```

Paste this and fill in your values after each `=` (every setting is also
explained in [`worker/.env.example`](../../worker/.env.example)):

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=

# Optional:
# WORKER_NAME=encoder-1
# MEDIA_PUBLIC_URL=https://media.example.com
```

Save with `Ctrl+O`, `Enter`, and leave with `Ctrl+X`.

Where each value comes from:

| Name | Where to find it |
| --- | --- |
| `SUPABASE_URL` | [API keys](https://supabase.com/dashboard/project/_/settings/api-keys), the **Project URL**. The same value as `NEXT_PUBLIC_SUPABASE_URL` on the website. |
| `SUPABASE_SERVICE_ROLE_KEY` | [API keys](https://supabase.com/dashboard/project/_/settings/api-keys), a **Secret key** (or the legacy `service_role` key) |
| `R2_ACCOUNT_ID` | the [R2 overview page](https://dash.cloudflare.com/?to=/:account/r2/overview), **Account ID** |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | [Manage R2 API Tokens](https://dash.cloudflare.com/?to=/:account/r2/api-tokens), **Create API token** with **Object Read & Write** on the clip bucket only. A separate token for the encoder makes it easy to revoke. |
| `R2_BUCKET` | the name of the clip bucket, the same as the website uses |
| `WORKER_NAME` | optional, shown in the `encode_jobs.worker` column. Defaults to the server's name. Give every encoder box its own. |
| `MEDIA_PUBLIC_URL` | optional. If you connected a [custom domain to the bucket](https://developers.cloudflare.com/r2/buckets/public-buckets/) and set `MEDIA_PUBLIC_URL` on the website, put the same value here and `thumbnail_url` is filled in with a link on that domain. Without it the website makes a short lived link to the cover itself. |

The installer refuses to run until the first six are filled in.

Two more settings exist, `WORK_DIR` and `STATE_DIR`. On the box you do not set
them: the image already points them at `/work` and `/state`, which are the folders
`/opt/yaptok-encoder/work` and `/opt/yaptok-encoder/state` on the server. They
matter only when you run the worker by hand without Docker (see
`worker/.env.example`): `WORK_DIR` is where sources are downloaded and encoded,
`STATE_DIR` is where the worker keeps the busy marker the update script checks.

**The secret key can read and change everything in the database.** It lives only
in this file on this box: never in the repository, never in a chat, and never on
the website's server. If it ever leaks, roll it on the API keys page and paste
the new one here.

## 4. Run the installer

```bash
curl -fsSL https://raw.githubusercontent.com/myfilehero/yaptok/main/ops/encoder/install.sh -o install.sh
bash install.sh
```

(If the repository is private, that download fails. Open
[`ops/encoder/install.sh`](https://github.com/myfilehero/yaptok/blob/main/ops/encoder/install.sh)
on GitHub, click **Copy raw file**, and paste it into `nano install.sh` instead.)

It installs Docker, the `yaptok-encoder` service (starts on boot), log rotation
and a timer that checks for a new image every 5 minutes. Running it again is safe.

## 5. Let the box pull the image

The image is `ghcr.io/myfilehero/yaptok-encoder`. GitHub builds it the first
time `worker/` reaches the `release` branch. You can also start a build by hand:
**Actions > encoder > Run workflow** on the
[Actions page](https://github.com/myfilehero/yaptok/actions/workflows/encoder.yml).

Then make the package public so the box can pull it without a login:
[Your packages](https://github.com/myfilehero?tab=packages) >
**yaptok-encoder** > **Package settings** > **Change visibility** > **Public**.
GitHub docs: [Configuring a package's visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility).

Within 5 minutes the box pulls it and starts the worker. To not wait, run:

```bash
yaptok-encoder-update && systemctl start yaptok-encoder
```

## 6. Switch processing on

Open the admin panel at `https://yaptok.example.com/admin` (your domain) and set
**Processing** to **Test** (only you and the testers you list) or **Everyone**.
**Upload** needs to be on too, or nobody can send a clip in.

While Processing is off the worker takes no jobs. On Test it only encodes clips
of the listed testers. Uploads made before it was on wait in line and start as
soon as it is.

## 7. Watch the log

```bash
docker logs -f yaptok-encoder
```

One line per step, for example:

```
2026-11-04T10:00:00.000Z ffmpeg ffmpeg version 5.1 Copyright (c) the FFmpeg developers
2026-11-04T10:00:00.100Z start worker=encoder-1 polling every 5s
2026-11-04T10:02:11.000Z claim job=1a2b3c4d video=5e6f7a8b attempt=1 worker=encoder-1 uploads/.../source.mp4
2026-11-04T10:02:11.200Z head job=1a2b3c4d video=5e6f7a8b source is 48.2 MB, size matches
2026-11-04T10:02:11.300Z disk job=1a2b3c4d video=5e6f7a8b 140.3 GB free, 1.1 GB needed
2026-11-04T10:02:12.900Z download job=1a2b3c4d video=5e6f7a8b 48.2 MB in 1.6s
2026-11-04T10:02:13.100Z probe job=1a2b3c4d video=5e6f7a8b duration=32.0 size=1080x1920 audio=true renditions 360p(360x640) 720p(720x1280) 1080p(1080x1920)
2026-11-04T10:02:49.000Z encode job=1a2b3c4d video=5e6f7a8b 3 renditions in 35.9s
2026-11-04T10:02:50.000Z thumbnails job=1a2b3c4d video=5e6f7a8b 3 thumbnails and a 7 frame sprite in 1.0s
2026-11-04T10:02:52.000Z upload job=1a2b3c4d video=5e6f7a8b 38 files, 31.4 MB in 2.0s
2026-11-04T10:02:52.300Z done job=1a2b3c4d video=5e6f7a8b ready in 41.3s
2026-11-04T10:02:52.400Z cleanup job=1a2b3c4d video=5e6f7a8b temp folder removed
```

Updates are logged in `/var/log/yaptok-encoder-update.log`.

Check that ffmpeg works on the box (encodes a short test clip):

```bash
docker exec yaptok-encoder node --test test/
```

---

## What it makes

Everything for a clip lives under `hls/<video id>/` in the bucket:

| File | What it is |
| --- | --- |
| `master.m3u8` | the HLS master playlist (`videos.hls_key`) |
| `360p/`, `720p/`, `1080p/` | one folder per size, each with a playlist, an `init.mp4` and 4 second `.m4s` segments |
| `thumb-1.webp`, `thumb-2.webp`, `thumb-3.webp` | still frames, 1280 wide. The first is the cover: the frame the creator picked on the upload page, or 10% into the clip. The others are at 50% and 90%. |
| `sprite.webp`, `sprite.vtt` | the preview sprite: one 160x90 frame every 5 seconds (at most 100), and the WebVTT file that maps time to frame (`videos.preview_sprite_key`) |

- **Never upscaled.** A 720p upload gets 360p and 720p. Something well between two
  sizes also gets one at its own size. Vertical clips count their short side, so
  a 1080x1920 phone clip is 1080p.
- **H.264 and AAC**, keyframes every 4 seconds, `veryfast` x264 preset.
- **fMP4 segments, not MPEG-TS.** They have less overhead and play in hls.js and
  in browsers that play HLS on their own.
- **The length limit is checked again.** The worker measures the real length of
  every clip. One that is longer than the **Longest clip** setting at
  `/admin/settings` is refused, whatever the browser said at upload time.

## Deleted clips

When a clip is deleted (by its owner, or because the account was deleted), the
database queues the clip's two folders, `hls/<video id>/` and
`uploads/<owner id>/<video id>/`, in the `storage_cleanup` table. When the worker
has no encode to do it looks at that table every 10 minutes, claims up to 20
folders, deletes every object under each one and marks it `done` with the count.
A folder that fails is tried again later, up to 5 times; the reason is in
`storage_cleanup.error`. The worker only ever deletes under those two kinds of
folder, and the table refuses anything else.

This needs the token's **Object Read & Write** permission, which also covers
deleting. Nothing else to set up.

## When something goes wrong

- A failed encode is tried again, up to 3 attempts. After that the clip is
  marked `failed`. The `encode_jobs` table in the
  [table editor](https://supabase.com/dashboard/project/_/editor)
  has the reason in its `error` column.
- An upload whose size in R2 does not match what the browser said, a file that
  is not a video, and a clip that is too long are refused right away, without
  retries.
- If the box crashes during an encode, the worker gives the job back when it
  starts again. A job stuck as `running` for more than 2 h 15 min is taken back
  by the next worker that asks.
- To try a failed clip again, set its `status` back to `uploaded` in the
  `videos` table. The job is queued again.
- The log says `missing settings: ...` and the worker keeps restarting: a
  required line in `/opt/yaptok-encoder/.env` is empty. Fix it, then run
  `systemctl restart yaptok-encoder`.
- To change a setting later: edit `/opt/yaptok-encoder/.env`, then
  `systemctl restart yaptok-encoder`.
- To stop the encoder: `systemctl stop yaptok-encoder`. A running job goes back
  in the queue.

## Files on the box

| Path | What it is |
| --- | --- |
| `/opt/yaptok-encoder/.env` | Your settings |
| `/opt/yaptok-encoder/docker-compose.yml` | How the container runs (written by the installer, with this server's name as the worker's name) |
| `/opt/yaptok-encoder/work` | The source and the encoded files of the one running job. Emptied after every job. |
| `/opt/yaptok-encoder/state` | Holds the `busy` marker while an encode runs |
| `/etc/systemd/system/yaptok-encoder.service` | Starts the worker on boot |
| `/usr/local/bin/yaptok-encoder-update` | The updater |
| `/etc/systemd/system/yaptok-encoder-update.service`, `yaptok-encoder-update.timer` | Run the updater every 5 minutes |
| `/etc/logrotate.d/yaptok-encoder-update` | Keeps 8 weeks of the updater's log |
| `/var/log/yaptok-encoder-update.log` | The updater's log |

The worker's own log is kept by Docker: 5 files of 10 MB at most.

**How the updater works.** Every 5 minutes `yaptok-encoder-update` pulls
`ghcr.io/myfilehero/yaptok-encoder:latest`. If the image is new and no encode is
running, it restarts the worker on it. If an encode is running (the `busy`
marker is there and younger than 140 minutes), it waits and tries again 5 minutes
later.

## Files in this folder

- `Dockerfile`: the worker image (Node 22 and ffmpeg from Debian), built from `worker/`
- `docker-compose.yml`: the service, its work and state folders and log limits
- `install.sh`: the installer from step 4
- `../../.github/workflows/encoder.yml`: tests the worker and builds the image on push to `release`
