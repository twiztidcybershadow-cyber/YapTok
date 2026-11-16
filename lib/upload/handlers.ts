// The logic behind /api/upload/sign, /api/upload/complete and /api/upload/abort.
// The route files only wire in the real R2 storage, the Supabase calls and the
// signed in user, so the tests can run all of this with fakes.
// Only relative imports, so Node can load this file directly in the tests.

import {
  CAPTION_MAX,
  PART_SIZE,
  PART_URL_TTL_S,
  cleanCoverAt,
  cleanHashtags,
  fileProblemCode,
  isUuid,
  keyBelongsTo,
  planParts,
  uploadErrorText,
  type UploadLimits,
  type Visibility,
} from "./rules.ts";

export type CompletedPart = { partNumber: number; etag: string };

/** What the routes need from R2. lib/upload/r2.ts implements it with the S3 API. */
export type UploadStorage = {
  createMultipart(key: string, mime: string): Promise<string>;
  presignPart(key: string, uploadId: string, partNumber: number, expiresIn: number): Promise<string>;
  completeMultipart(key: string, uploadId: string, parts: CompletedPart[]): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
  /** The object's size in bytes, or null when it does not exist. */
  objectSize(key: string): Promise<number | null>;
};

/** What the person filled in before pressing Post, already cleaned. */
export type NewClip = {
  caption: string;
  hashtags: string[];
  bytes: number;
  mime: string;
  /** What the browser measured, or null. The encoder measures again. */
  durationS: number | null;
  /** Where the cover frame is, in seconds, or null to let the encoder pick. */
  coverAt: number | null;
  visibility: Visibility;
};

export type VideoRow = {
  id: string;
  ownerId: string;
  status: string;
  sourceKey: string | null;
  sourceBytes: number | null;
  sourceMime: string | null;
};

/** An error code from the database (see the RPCs in 004_videos.sql), or null. */
export type DbError = string | null;

/** What the routes need from the database. lib/upload/db.ts implements it with Supabase. */
export type UploadDb = {
  createUpload(clip: NewClip): Promise<{ videoId: string; key: string } | { error: string }>;
  getVideo(id: string): Promise<VideoRow | null>;
  finishUpload(id: string): Promise<DbError>;
  abandonUpload(id: string, reason: string): Promise<DbError>;
};

export type UploadContext = {
  /** null when the R2 settings are missing. */
  storage: UploadStorage | null;
  /** null when the Supabase settings are missing. */
  db: UploadDb | null;
  /** The signed in user id, or null. */
  userId: () => Promise<string | null>;
  flagOn: (userId: string) => Promise<boolean>;
  /** The size and length limits from the site settings. */
  limits: () => Promise<UploadLimits>;
};

export type HandlerResult = { status: number; body: Record<string, unknown> };

function fail(status: number, code: string, limits?: UploadLimits): HandlerResult {
  return { status, body: { error: code, message: uploadErrorText(code, limits) } };
}

/**
 * Storage said no. The answer carries the name of the storage error (like
 * AccessDenied or NoSuchBucket, never a key) so the owner can see which
 * setting is wrong without opening the server log.
 */
function storageFail(err: unknown): HandlerResult {
  const name = err instanceof Error && /^[A-Za-z]{3,60}$/.test(err.name) && err.name !== "Error" ? err.name : null;
  const text = uploadErrorText("storage_error");
  return { status: 502, body: { error: "storage_error", message: name ? `${text} (${name})` : text } };
}

/** HTTP status for an error code from the RPCs. */
export function statusForCode(code: string): number {
  switch (code) {
    case "not_signed_in":
      return 401;
    case "upload_off":
    case "not_onboarded":
    case "not_allowed":
    case "banned":
      return 403;
    case "not_found":
      return 404;
    case "not_uploading":
      return 409;
    case "file_too_big":
    case "too_long":
      return 413;
    case "bad_type":
      return 415;
    case "daily_limit":
      return 429;
    case "caption_too_long":
    case "bad_visibility":
    case "file_empty":
      return 400;
    default:
      return 500;
  }
}

type Gate = { ok: true; userId: string; storage: UploadStorage; db: UploadDb } | { ok: false; result: HandlerResult };

/** Every route checks the same things in the same order. */
async function gate(ctx: UploadContext): Promise<Gate> {
  if (!ctx.storage) return { ok: false, result: fail(501, "not_configured") };
  if (!ctx.db) return { ok: false, result: fail(503, "no_db") };
  const userId = await ctx.userId();
  if (!userId) return { ok: false, result: fail(401, "not_signed_in") };
  if (!(await ctx.flagOn(userId))) return { ok: false, result: fail(403, "upload_off") };
  return { ok: true, userId, storage: ctx.storage, db: ctx.db };
}

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

/**
 * POST /api/upload/sign  { caption, hashtags, visibility, bytes, mime, durationS, coverAt }
 * Makes the clip row, starts a multipart upload in R2 and presigns a PUT URL
 * for every 16 MB part. The browser uploads the parts straight to R2.
 */
export async function signUpload(rawBody: unknown, ctx: UploadContext): Promise<HandlerResult> {
  const g = await gate(ctx);
  if (!g.ok) return g.result;
  const body = asRecord(rawBody);
  const caption = typeof body.caption === "string" ? body.caption.trim() : "";
  const bytes = typeof body.bytes === "number" ? body.bytes : NaN;
  const mime = typeof body.mime === "string" ? body.mime : "";
  const durationS = typeof body.durationS === "number" && Number.isFinite(body.durationS) && body.durationS > 0 ? body.durationS : null;

  // Same checks as the browser and the database. The type is already decided, so no file name.
  const limits = await ctx.limits();
  const problem = fileProblemCode({ name: "", type: mime, size: bytes }, limits, durationS);
  if (problem) return fail(statusForCode(problem), problem, limits);
  if (caption.length > CAPTION_MAX) return fail(400, "caption_too_long");

  const created = await g.db.createUpload({
    caption,
    hashtags: cleanHashtags(Array.isArray(body.hashtags) ? body.hashtags : []),
    bytes,
    mime,
    durationS,
    coverAt: cleanCoverAt(body.coverAt, durationS),
    visibility: body.visibility === "private" ? "private" : "public",
  });
  if ("error" in created) return fail(statusForCode(created.error), created.error, limits);
  const { videoId, key } = created;
  if (!keyBelongsTo(key, g.userId)) {
    await g.db.abandonUpload(videoId, "bad key");
    return fail(500, "bad_key");
  }

  let uploadId: string;
  try {
    uploadId = await g.storage.createMultipart(key, mime);
  } catch (err) {
    await g.db.abandonUpload(videoId, "storage error");
    return storageFail(err);
  }

  const plan = planParts(bytes);
  const urls = await Promise.all(
    plan.map((p) => g.storage.presignPart(key, uploadId, p.partNumber, PART_URL_TTL_S)),
  );
  return {
    status: 200,
    body: {
      videoId,
      key,
      uploadId,
      partSize: PART_SIZE,
      expiresAt: new Date(Date.now() + PART_URL_TTL_S * 1000).toISOString(),
      parts: plan.map((p, i) => ({ partNumber: p.partNumber, url: urls[i] })),
    },
  };
}

/** The parts list from the browser: 1..n in any order, each with an ETag. */
export function readParts(value: unknown, expected: number): CompletedPart[] | null {
  if (!Array.isArray(value) || value.length !== expected) return null;
  const parts: CompletedPart[] = [];
  for (const item of value) {
    const r = asRecord(item);
    const partNumber = r.partNumber;
    const etag = r.etag;
    if (typeof partNumber !== "number" || !Number.isInteger(partNumber)) return null;
    if (typeof etag !== "string" || !etag || etag.length > 200) return null;
    parts.push({ partNumber, etag });
  }
  parts.sort((a, b) => a.partNumber - b.partNumber);
  return parts.every((p, i) => p.partNumber === i + 1) ? parts : null;
}

async function ownUpload(
  g: Extract<Gate, { ok: true }>,
  body: Record<string, unknown>,
): Promise<{ video: VideoRow & { sourceKey: string }; uploadId: string } | HandlerResult> {
  const videoId = body.videoId;
  const uploadId = body.uploadId;
  if (!isUuid(videoId)) return fail(400, "bad_video_id");
  if (typeof uploadId !== "string" || !uploadId || uploadId.length > 1024) return fail(400, "bad_upload_id");
  const video = await g.db.getVideo(videoId);
  // RLS already hides other people's videos; the owner check is a second lock.
  if (!video || video.ownerId !== g.userId || !video.sourceKey) return fail(404, "not_found");
  if (!keyBelongsTo(video.sourceKey, g.userId)) return fail(404, "not_found");
  return { video: { ...video, sourceKey: video.sourceKey }, uploadId };
}

/**
 * POST /api/upload/complete  { videoId, uploadId, parts: [{ partNumber, etag }] }
 * Joins the parts in R2, checks the object is there with the right size and
 * marks the clip uploaded, which queues it for the encoder.
 */
export async function completeUpload(rawBody: unknown, ctx: UploadContext): Promise<HandlerResult> {
  const g = await gate(ctx);
  if (!g.ok) return g.result;
  const body = asRecord(rawBody);
  const own = await ownUpload(g, body);
  if ("status" in own) return own;
  const { video, uploadId } = own;

  if (video.status === "uploaded") return done(video.id);
  if (video.status !== "uploading") return fail(409, "not_uploading");

  const parts = readParts(body.parts, planParts(video.sourceBytes ?? 0).length);
  if (!parts) return fail(400, "bad_parts");

  try {
    await g.storage.completeMultipart(video.sourceKey, uploadId, parts);
  } catch (err) {
    return storageFail(err);
  }

  const size = await g.storage.objectSize(video.sourceKey).catch(() => null);
  if (size === null || size !== video.sourceBytes) {
    await g.db.abandonUpload(video.id, size === null ? "file missing in storage" : "size mismatch");
    return fail(422, "size_mismatch");
  }

  const err = await g.db.finishUpload(video.id);
  if (err) return fail(statusForCode(err), err);
  return done(video.id);
}

function done(videoId: string): HandlerResult {
  return { status: 200, body: { videoId, status: "uploaded", clipUrl: `/v/${videoId}` } };
}

/**
 * POST /api/upload/abort  { videoId, uploadId }
 * Cancel: throws the uploaded parts away in R2 and marks the clip failed.
 */
export async function abortUpload(rawBody: unknown, ctx: UploadContext): Promise<HandlerResult> {
  const g = await gate(ctx);
  if (!g.ok) return g.result;
  const own = await ownUpload(g, asRecord(rawBody));
  if ("status" in own) return own;
  const { video, uploadId } = own;
  if (video.status !== "uploading" && video.status !== "failed") return fail(409, "not_uploading");

  // A missing upload id (already aborted or completed) is fine here.
  await g.storage.abortMultipart(video.sourceKey, uploadId).catch(() => undefined);
  const err = await g.db.abandonUpload(video.id, "cancelled");
  if (err && err !== "not_uploading") return fail(statusForCode(err), err);
  return { status: 200, body: { videoId: video.id, status: "failed" } };
}
