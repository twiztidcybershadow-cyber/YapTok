// Made up accounts and test pattern clips for the local stack
// (scripts/local-stack.mjs --seed). Nothing here is real: the people are
// invented, the clips are moving color gradients drawn by ffmpeg with a label
// on top, encoded with the same arguments the encoder worker uses.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildEncodeArgs, buildThumbnailArgs, MASTER_PLAYLIST, SPRITE_IMAGE, SPRITE_VTT, thumbnailName } from "../worker/lib/ffmpeg.mjs";
import { pickRenditions } from "../worker/lib/ladder.mjs";
import { buildVtt, spritePlan } from "../worker/lib/sprite.mjs";

export const PASSWORD = "yaptok-local";

const PEOPLE = [
  { username: "owner", name: "Antic (owner)", admin: true, verified: true, bio: "Runs this copy of YapTok." },
  { username: "mira", name: "Mira Okafor", verified: true, bio: "Bakes, burns, tries again." },
  { username: "tobi", name: "Tobi Lindqvist", bio: "Skate clips and bad puns." },
  { username: "desk_lab", name: "Desk Lab", bio: "Tiny desk builds." },
  { username: "juno", name: "Juno Park", bio: "Plants I have not killed yet." },
  { username: "spam_sam", name: "Sam", bio: "" },
];

const CLIPS = [
  { by: "mira", caption: "Sourdough, attempt nine. It rose!", tags: ["baking", "sourdough"], colors: ["f59e0b", "7c3aed", "f43f5e"], seconds: 7 },
  { by: "tobi", caption: "First kickflip of the year", tags: ["skate", "progress"], colors: ["06b6d4", "1e1b4b", "a78bfa"], seconds: 6 },
  { by: "desk_lab", caption: "Cable tray in 20 seconds", tags: ["desksetup", "diy"], colors: ["10b981", "0e0b14", "fbbf24"], seconds: 8 },
  { by: "juno", caption: "The monstera finally has a new leaf", tags: ["plants"], colors: ["16a34a", "a3e635", "0f766e"], seconds: 6 },
  { by: "mira", caption: "Do not open the oven early. I opened the oven early.", tags: ["baking", "fail"], colors: ["ef4444", "f59e0b", "7c2d12"], seconds: 6 },
  { by: "tobi", caption: "Rainy day, indoor park", tags: ["skate"], colors: ["3b82f6", "0e0b14", "22d3ee"], seconds: 7 },
  { by: "spam_sam", caption: "FREE followers click the link in my bio!!!", tags: ["follow4follow"], colors: ["facc15", "ef4444", "facc15"], seconds: 6 },
  { by: "juno", caption: "Watering day, with commentary", tags: ["plants", "routine"], colors: ["84cc16", "14532d", "f0abfc"], seconds: 8 },
  { by: "desk_lab", caption: "Monitor arm: worth it?", tags: ["desksetup"], colors: ["8b5cf6", "111827", "f472b6"], seconds: 6 },
  { by: "mira", caption: "Cinnamon rolls, the lazy way", tags: ["baking", "recipe"], colors: ["b45309", "fde68a", "7c2d12"], seconds: 7 },
  { by: "juno", caption: "Repotting day went sideways", tags: ["plants", "fail"], colors: ["065f46", "fbbf24", "022c22"], seconds: 6 },
  { by: "tobi", caption: "Learning to drop in. Slowly.", tags: ["skate", "progress"], colors: ["0ea5e9", "f97316", "0c4a6e"], seconds: 7 },
  { by: "owner", caption: "Welcome to YapTok. Say hi in the comments", tags: ["yaptok", "welcome"], colors: ["fc6a39", "fbbf24", "0f0d0c"], seconds: 6 },
  { by: "desk_lab", caption: "The 5 dollar cable fix", tags: ["desksetup", "diy"], colors: ["14b8a6", "1e293b", "e2e8f0"], seconds: 6 },
  { by: "mira", caption: "Rating my own bread, honestly", tags: ["baking", "sourdough"], colors: ["a16207", "fef3c7", "44403c"], seconds: 8 },
  { by: "juno", caption: "Morning light, no talking", tags: ["plants", "routine"], colors: ["fda4af", "86efac", "fde047"], seconds: 6 },
];

const COMMENTS = ["This is great", "How long did that take?", "Saving this for later", "ok this made my day", "Tutorial please", "The ending though", "Wait, do it again", "Instant follow"];

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
  if (res.error) throw new Error(`${cmd} could not start (${res.error.message}). --seed needs ffmpeg on the PATH.`);
  if (res.status !== 0) throw new Error(`${cmd} failed: ${res.stderr.toString().slice(-400)}`);
}

/** A vertical 720x1280 test clip: a slow moving gradient, the caption as a label, a quiet tone. */
function makeSource(file, clip, n) {
  const [c0, c1, c2] = clip.colors;
  const label = clip.caption.replace(/[':\\,%]/g, "").slice(0, 26);
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `gradients=s=720x1280:r=30:d=${clip.seconds}:c0=0x${c0}:c1=0x${c1}:c2=0x${c2}:nb_colors=3:speed=0.02:seed=${n + 1}`,
    "-f", "lavfi", "-i", `sine=frequency=${180 + n * 40}:duration=${clip.seconds}`,
    "-vf", `drawtext=text='${label}':fontcolor=white:fontsize=44:x=(w-text_w)/2:y=h*0.42:box=1:boxcolor=black@0.35:boxborderw=18,drawtext=text='test clip ${n + 1}':fontcolor=white@0.8:fontsize=30:x=(w-text_w)/2:y=h*0.42+90`,
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-af", "volume=0.15", "-shortest", file,
  ]);
}

export async function seed({ adminQuery, hashPassword, objectsDir, mediaBase }) {
  const q = adminQuery;
  const DAY = 86400000;
  const now = Date.now();

  // People. The signup trigger makes each profile; the rest is what the forms would do.
  const ids = {};
  for (const [i, p] of PEOPLE.entries()) {
    const { rows } = await q(
      "insert into auth.users (email, password_hash, raw_user_meta_data, created_at) values ($1, $2, $3, $4) returning id",
      [`${p.username}@example.com`, hashPassword(PASSWORD), JSON.stringify({ username: p.username, full_name: p.name }), new Date(now - (13 - i * 2) * DAY)],
    );
    ids[p.username] = rows[0].id;
    await q("update public.profiles set onboarded = true, birthdate = '1995-05-05', bio = $2, verified = $3, created_at = $4 where id = $1", [
      rows[0].id, p.bio, p.verified === true, new Date(now - (13 - i * 2) * DAY),
    ]);
    if (p.admin) await q("insert into public.admins (user_id, note) values ($1, 'owner')", [rows[0].id]);
  }
  // A few quiet accounts, so the sign-up chart has something on most days.
  for (let i = 0; i < 14; i++) {
    const made = new Date(now - (i % 12) * DAY - i * 3600000);
    const { rows } = await q("insert into auth.users (email, password_hash, raw_user_meta_data, created_at) values ($1, $2, $3, $4) returning id", [
      `viewer${i + 1}@example.com`, hashPassword(PASSWORD), JSON.stringify({ username: `viewer_${i + 1}` }), made,
    ]);
    ids[`viewer_${i + 1}`] = rows[0].id;
    await q("update public.profiles set onboarded = true, birthdate = '1998-01-01', created_at = $2 where id = $1", [rows[0].id, made]);
  }

  // The owner switches the features on through the real function, so the panel shows who did it.
  const asOwner = async (text, params) => {
    await q("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: ids.owner, role: "authenticated" })]);
    try {
      return await q(text, params);
    } finally {
      await q("select set_config('request.jwt.claims', '', false)");
    }
  };
  for (const key of ["messages", "inbox", "feed", "profiles", "likes", "comments", "follows", "share", "reports", "upload", "processing", "gestures", "scrub", "following", "saves", "hashtags", "search", "discover", "follow_lists", "comment_threads"]) {
    await asOwner("select public.set_feature_flag($1, 'everyone')", [key]);
  }
  await asOwner("select public.set_feature_flag('record', 'test')");

  // Clips: made by ffmpeg, encoded like the worker does, put where the worker would put them.
  process.stdout.write("making test clips ");
  for (const [n, clip] of CLIPS.entries()) {
    const { rows } = await q("select gen_random_uuid() as id");
    const id = rows[0].id;
    const dir = join(objectsDir, "hls", id);
    mkdirSync(dir, { recursive: true });
    const source = join(dir, "source.mp4");
    makeSource(source, clip, n);
    const probe = { width: 720, height: 1280, durationS: clip.seconds, hasAudio: true, fps: 30 };
    const renditions = pickRenditions(probe);
    const sprite = spritePlan(probe.durationS);
    run("ffmpeg", buildEncodeArgs({ input: source, renditions, hasAudio: true, sprite }), dir);
    run("ffmpeg", buildThumbnailArgs({ input: source, atSeconds: 1, output: join(dir, thumbnailName(0)) }));
    writeFileSync(join(dir, SPRITE_VTT), buildVtt(sprite, probe.durationS, SPRITE_IMAGE));
    run("rm", ["-f", source]);
    const made = new Date(now - (CLIPS.length - n) * 0.8 * DAY);
    const top = renditions[renditions.length - 1];
    await q(
      `insert into public.videos (id, owner_id, caption, hashtags, visibility, status, duration_s, width, height, hls_key, thumbnail_url, renditions, created_at, published_at)
       values ($1, $2, $3, $4, 'public', 'ready', $5, $6, $7, $8, $9, $10, $11, $11)`,
      [id, ids[clip.by], clip.caption, clip.tags, clip.seconds, top.width, top.height, `hls/${id}/${MASTER_PLAYLIST}`, `${mediaBase}/hls/${id}/${thumbnailName(0)}`, JSON.stringify(renditions), made],
    );
    clip.id = id;
    process.stdout.write(".");
  }
  console.log(" done");

  // Likes, follows, comments and views, with the counts kept by the real triggers.
  const viewers = Object.keys(ids).filter((u) => u !== "spam_sam");
  for (const [n, clip] of CLIPS.entries()) {
    for (const [v, viewer] of viewers.entries()) {
      if (viewer === clip.by) continue;
      if ((n * 7 + v * 3) % 5 < 3) await q("insert into public.likes (video_id, user_id) values ($1, $2) on conflict do nothing", [clip.id, ids[viewer]]);
      if ((n + v) % 6 === 0) {
        await q("insert into public.comments (video_id, author_id, body, created_at) values ($1, $2, $3, $4)", [clip.id, ids[viewer], COMMENTS[(n + v) % COMMENTS.length], new Date(now - ((n + v) % 9) * 3600000)]);
      }
      if ((n * 3 + v) % 7 === 0) await q("insert into public.saves (video_id, user_id) values ($1, $2) on conflict do nothing", [clip.id, ids[viewer]]);
      if ((n + v) % 4 === 0) await q("insert into public.follows (follower_id, followee_id) values ($1, $2) on conflict do nothing", [ids[viewer], ids[clip.by]]);
    }
    let total = 0;
    for (let d = 0; d < 14; d++) {
      const views = Math.max(0, Math.round((14 - d) * (3 + (n % 4)) * (1 + ((n * 5 + d * 3) % 7) / 6)) - (CLIPS.length - n) * 2);
      if (views === 0 || d > (CLIPS.length - n) * 0.8) continue;
      total += views;
      await q("insert into public.video_views (video_id, day, views) values ($1, current_date - $2::int, $3)", [clip.id, d, views]);
    }
    await q("update public.videos set view_count = $2, share_count = $3 where id = $1", [clip.id, total, n % 5]);
  }

  // A few replies and comment likes, so threads have something in them.
  const { rows: tops } = await q("select id, video_id, author_id from public.comments where parent_id is null order by created_at limit 14");
  const REPLIES = ["Right?", "Thank you!", "About two hours", "Same here", "Coming soon"];
  for (const [i, c] of tops.entries()) {
    const others = viewers.filter((u) => ids[u] !== c.author_id);
    if (i % 2 === 0) await q("insert into public.comments (video_id, author_id, body, parent_id) values ($1, $2, $3, $4)", [c.video_id, ids[others[i % others.length]], REPLIES[i % REPLIES.length], c.id]);
    for (let k = 0; k < (i * 3) % 5; k++) await q("insert into public.comment_likes (comment_id, user_id) values ($1, $2) on conflict do nothing", [c.id, ids[others[(i + k) % others.length]]]);
  }

  // A couple of conversations for the Messages page.
  const dm = (from, to, body, video = null) => q("insert into public.messages (sender_id, receiver_id, body, video_id) values ($1, $2, $3, $4)", [ids[from], ids[to], body, video]);
  await dm("mira", "owner", "Hi! Love what you are building here");
  await dm("owner", "mira", "Thank you! Your bread clips are the best thing on the feed");
  await dm("mira", "owner", "Look at this one", CLIPS[1].id);
  await dm("tobi", "owner", "Can I get verified?");
  await dm("juno", "mira", "", CLIPS[3].id);

  // Something for the moderation queue and the log.
  const spam = CLIPS.find((c) => c.by === "spam_sam");
  const insertReport = "insert into public.reports (reporter_id, target_type, video_id, comment_id, reason, note) values ($1, $2, $3, $4, $5, $6)";
  await q(insertReport, [ids.mira, "video", spam.id, null, "spam", "Same clip posted over and over."]);
  await q(insertReport, [ids.tobi, "video", spam.id, null, "spam", ""]);
  const { rows: rude } = await q("insert into public.comments (video_id, author_id, body) values ($1, $2, $3) returning id", [CLIPS[0].id, ids.spam_sam, "nobody cares, follow me instead"]);
  await q(insertReport, [ids.juno, "comment", CLIPS[0].id, rude[0].id, "harassment", "Rude for no reason."]);
  await asOwner("select public.set_site_setting('upload_max_seconds', '90')");
  await asOwner("select public.admin_set_mark($1, 'invited', true)", [ids.tobi]);
}
