// The sign, complete and abort routes end to end, with the S3 client's send()
// mocked and an in-memory database. Presigning is real (it needs no network).
import assert from "node:assert/strict";
import { test } from "node:test";
import { abortUpload, completeUpload, signUpload } from "../lib/upload/handlers.ts";
import { createR2Client, createR2Storage } from "../lib/upload/r2.ts";
import { PART_SIZE, sourceKey } from "../lib/upload/rules.ts";

const OWNER = "11111111-2222-3333-4444-555555555555";
const MB = 1024 * 1024;
const LIMITS = { maxBytes: 200 * MB, maxSeconds: 60 };

function setup({ userId = OWNER, flag = true, storage = true, db = true, headSize, dbError = null } = {}) {
  const client = createR2Client({ accountId: "example", accessKeyId: "test-key-id", secretAccessKey: "test-value" });
  const calls = [];
  const objects = new Map();
  const videos = new Map();
  client.send = async (command) => {
    const name = command.constructor.name;
    const input = command.input;
    calls.push({ name, input });
    if (name === "CreateMultipartUploadCommand") return { UploadId: "upload-1" };
    if (name === "CompleteMultipartUploadCommand") {
      objects.set(input.Key, headSize ?? videos.get(input.Key.split("/")[2]).sourceBytes);
      return {};
    }
    if (name === "AbortMultipartUploadCommand") return {};
    if (name === "HeadObjectCommand") {
      if (!objects.has(input.Key)) throw Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
      return { ContentLength: objects.get(input.Key) };
    }
    throw new Error("unexpected " + name);
  };

  let n = 0;
  const fakeDb = {
    async createUpload(clip) {
      if (dbError) return { error: dbError };
      const id = `aaaaaaaa-bbbb-cccc-dddd-${String(++n).padStart(12, "0")}`;
      const key = sourceKey(userId, id, clip.mime);
      videos.set(id, { id, ownerId: userId, status: "uploading", sourceKey: key, sourceBytes: clip.bytes, sourceMime: clip.mime, clip });
      return { videoId: id, key };
    },
    async getVideo(id) {
      const v = videos.get(id);
      return v && v.ownerId === userId ? { ...v } : null;
    },
    async finishUpload(id) {
      videos.get(id).status = "uploaded";
      return null;
    },
    async abandonUpload(id, reason) {
      Object.assign(videos.get(id), { status: "failed", error: reason });
      return null;
    },
  };

  const ctx = {
    storage: storage ? createR2Storage(client, "yaptok-test") : null,
    db: db ? fakeDb : null,
    userId: async () => userId,
    flagOn: async () => flag,
    limits: async () => LIMITS,
  };
  return { ctx, calls, videos };
}

const good = { caption: "hello", hashtags: ["#Cats", "cats", "so cute"], bytes: 40 * MB, mime: "video/mp4", durationS: 12, coverAt: 3 };

test("sign: 501 when storage is not configured", async () => {
  const res = await signUpload(good, setup({ storage: false }).ctx);
  assert.equal(res.status, 501);
  assert.equal(res.body.error, "not_configured");
});

test("sign: signed out, flag off and no database are refused", async () => {
  assert.equal((await signUpload(good, setup({ userId: null }).ctx)).status, 401);
  assert.equal((await signUpload(good, setup({ flag: false }).ctx)).body.error, "upload_off");
  assert.equal((await signUpload(good, setup({ db: false }).ctx)).body.error, "no_db");
});

test("sign: files that break the owner's limits are refused before anything is created", async () => {
  const { ctx, calls, videos } = setup();
  assert.equal((await signUpload({ ...good, mime: "image/png" }, ctx)).body.error, "bad_type");
  assert.equal((await signUpload({ ...good, bytes: 0 }, ctx)).body.error, "file_empty");
  const big = await signUpload({ ...good, bytes: 201 * MB }, ctx);
  assert.equal(big.status, 413);
  assert.match(big.body.message, /200 MB/);
  const long = await signUpload({ ...good, durationS: 75 }, ctx);
  assert.equal(long.body.error, "too_long");
  assert.match(long.body.message, /60 seconds/);
  assert.equal((await signUpload({ ...good, caption: "x".repeat(301) }, ctx)).body.error, "caption_too_long");
  assert.equal(videos.size, 0);
  assert.equal(calls.length, 0);
});

test("sign: the database has the last word (not allowed, banned, daily limit)", async () => {
  assert.equal((await signUpload(good, setup({ dbError: "not_allowed" }).ctx)).status, 403);
  assert.equal((await signUpload(good, setup({ dbError: "banned" }).ctx)).status, 403);
  assert.equal((await signUpload(good, setup({ dbError: "daily_limit" }).ctx)).status, 429);
});

test("sign: cleans the form, starts a multipart upload and presigns one URL per 16 MB part", async () => {
  const { ctx, calls, videos } = setup();
  const res = await signUpload({ ...good, visibility: "private" }, ctx);
  assert.equal(res.status, 200);
  assert.equal(res.body.partSize, PART_SIZE);
  assert.equal(res.body.parts.length, 3);
  assert.match(res.body.parts[0].url, /partNumber=1/);
  assert.match(res.body.parts[0].url, /X-Amz-Signature=/);
  assert.equal(calls[0].name, "CreateMultipartUploadCommand");
  const { clip } = videos.get(res.body.videoId);
  assert.deepEqual(clip.hashtags, ["cats"]);
  assert.equal(clip.visibility, "private");
  assert.equal(clip.coverAt, 3);
  assert.equal(clip.durationS, 12);
});

test("sign: an unknown length is fine (the encoder measures), and the cover is then left to it", async () => {
  const { ctx, videos } = setup();
  const res = await signUpload({ ...good, durationS: null, coverAt: null }, ctx);
  assert.equal(res.status, 200);
  assert.equal(videos.get(res.body.videoId).clip.coverAt, null);
});

async function signed(opts) {
  const s = setup(opts);
  const res = await signUpload(good, s.ctx);
  const parts = res.body.parts.map((p) => ({ partNumber: p.partNumber, etag: `"etag-${p.partNumber}"` }));
  return { ...s, videoId: res.body.videoId, uploadId: res.body.uploadId, parts };
}

test("complete: joins the parts, checks the size and marks the clip uploaded", async () => {
  const { ctx, calls, videos, videoId, uploadId, parts } = await signed();
  const res = await completeUpload({ videoId, uploadId, parts: [...parts].reverse() }, ctx);
  assert.equal(res.status, 200);
  assert.equal(res.body.clipUrl, `/v/${videoId}`);
  assert.equal(videos.get(videoId).status, "uploaded");
  const complete = calls.find((c) => c.name === "CompleteMultipartUploadCommand");
  assert.deepEqual(complete.input.MultipartUpload.Parts.map((p) => p.PartNumber), [1, 2, 3]);
  // Pressing twice is fine.
  assert.equal((await completeUpload({ videoId, uploadId, parts }, ctx)).status, 200);
});

test("complete: a size mismatch marks the clip failed", async () => {
  const { ctx, videos, videoId, uploadId, parts } = await signed({ headSize: 5 });
  const res = await completeUpload({ videoId, uploadId, parts }, ctx);
  assert.equal(res.status, 422);
  assert.equal(videos.get(videoId).status, "failed");
});

test("complete: missing or extra parts are refused", async () => {
  const { ctx, videoId, uploadId, parts } = await signed();
  assert.equal((await completeUpload({ videoId, uploadId, parts: parts.slice(1) }, ctx)).body.error, "bad_parts");
  assert.equal((await completeUpload({ videoId, uploadId, parts: [...parts, { partNumber: 4, etag: "x" }] }, ctx)).body.error, "bad_parts");
});

test("complete and abort: someone else's clip is not found", async () => {
  const { ctx, videoId, uploadId, parts } = await signed();
  const other = { ...ctx, userId: async () => "99999999-8888-7777-6666-555555555555" };
  assert.equal((await completeUpload({ videoId, uploadId, parts }, other)).status, 404);
  assert.equal((await abortUpload({ videoId, uploadId }, other)).status, 404);
});

test("abort: throws the parts away and marks the clip failed", async () => {
  const { ctx, calls, videos, videoId, uploadId } = await signed();
  const res = await abortUpload({ videoId, uploadId }, ctx);
  assert.equal(res.status, 200);
  assert.equal(videos.get(videoId).status, "failed");
  assert.ok(calls.some((c) => c.name === "AbortMultipartUploadCommand"));
});
