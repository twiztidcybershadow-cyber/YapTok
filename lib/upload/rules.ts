// Upload rules shared by the /upload page, the API routes and the tests.
// Keep in step with public.create_upload() and public.clean_hashtags() in
// supabase/migrations/004_videos.sql.
// No imports on purpose, so Node can load this file directly.

/** The hard ceiling for one file. The real limit is the upload_max_mb site setting, which is never more. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
/** Every part is 16 MB except the last one. R2 wants at least 5 MB per part. */
export const PART_SIZE = 16 * 1024 * 1024;
/** How many parts upload at the same time. */
export const PARALLEL_PARTS = 3;
/** A failed part is tried again this many times before the upload gives up. */
export const PART_RETRIES = 3;
/** How long the presigned part URLs work, in seconds. */
export const PART_URL_TTL_S = 60 * 60;

export const CAPTION_MAX = 300;
export const HASHTAG_MAX = 30;
export const HASHTAGS_MAX = 8;

export const VISIBILITIES = ["public", "private"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const VIDEO_STATUSES = ["uploading", "uploaded", "processing", "ready", "failed"] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

/** The limits the owner sets at /admin/settings, as the upload needs them. */
export type UploadLimits = { maxBytes: number; maxSeconds: number };

export const DEFAULT_LIMITS: UploadLimits = { maxBytes: 200 * 1024 * 1024, maxSeconds: 60 };

/** Accepted video types and the extension each one is stored with. */
export const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
};

const EXTENSION_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
};

/** The `accept` attribute for the file picker. */
export const ACCEPT = ".mp4,.m4v,.mov,.webm,.mkv,video/mp4,video/quicktime,video/webm,video/x-matroska";

/**
 * The accepted type for a file, or null. Browsers often leave the type empty
 * for .mkv, and a recording's type carries its codecs ("video/webm;codecs=vp9"),
 * so the part before the ";" and then the extension decide.
 */
export function videoTypeFor(file: { name: string; type: string }): string | null {
  const type = file.type.split(";")[0].trim().toLowerCase();
  if (type in VIDEO_TYPES) return type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (file.name.includes(".") && ext in EXTENSION_TYPES) {
    if (!type || type === "application/octet-stream" || type.startsWith("video/")) {
      return EXTENSION_TYPES[ext];
    }
  }
  return null;
}

export type FileProblemCode = "bad_type" | "file_empty" | "file_too_big" | "too_long";

/**
 * The rule this file breaks, or null when it can be uploaded. durationS is
 * what the browser measured, or null when it could not tell (the encoder
 * measures again either way).
 */
export function fileProblemCode(
  file: { name: string; type: string; size: number },
  limits: UploadLimits = DEFAULT_LIMITS,
  durationS: number | null = null,
): FileProblemCode | null {
  if (!videoTypeFor(file)) return "bad_type";
  if (!Number.isSafeInteger(file.size) || file.size <= 0) return "file_empty";
  if (file.size > Math.min(limits.maxBytes, MAX_UPLOAD_BYTES)) return "file_too_big";
  // One second of slack, like the database: browsers round durations differently.
  if (durationS !== null && Number.isFinite(durationS) && durationS > limits.maxSeconds + 1) return "too_long";
  return null;
}

/**
 * Hashtags as typed to a clean list: lower case, letters, digits and
 * underscores, 1 to 30 characters, no repeats, at most 8. Anything else is
 * dropped, exactly like clean_hashtags() in the database.
 */
export function cleanHashtags(tags: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const tag = raw.replace(/^#+/, "").toLowerCase();
    if (!/^[a-z0-9_]{1,30}$/.test(tag) || out.includes(tag)) continue;
    out.push(tag);
    if (out.length >= HASHTAGS_MAX) break;
  }
  return out;
}

/** "#cats, Dogs  #so_cute" from the hashtag box to a clean list. Spaces and commas separate. */
export function parseHashtags(text: string): string[] {
  return cleanHashtags(text.split(/[\s,]+/).filter(Boolean));
}

/** Where the cover frame may sit: inside the clip, or null to let the encoder pick. */
export function cleanCoverAt(value: unknown, durationS: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const max = durationS !== null && Number.isFinite(durationS) && durationS > 0 ? durationS : 3600;
  return Math.round(Math.min(value, max) * 100) / 100;
}

export type Part = { partNumber: number; start: number; end: number };

/** Splits a file of `bytes` into numbered parts. `end` is exclusive, like Blob.slice. */
export function planParts(bytes: number, partSize = PART_SIZE): Part[] {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) return [];
  const parts: Part[] = [];
  for (let start = 0, n = 1; start < bytes; start += partSize, n++) {
    parts.push({ partNumber: n, start, end: Math.min(start + partSize, bytes) });
  }
  return parts;
}

/** The R2 key for an upload. The database builds the same key in create_upload(). */
export function sourceKey(ownerId: string, videoId: string, mime: string): string | null {
  const ext = VIDEO_TYPES[mime];
  if (!ext || !isUuid(ownerId) || !isUuid(videoId)) return null;
  return `uploads/${ownerId.toLowerCase()}/${videoId.toLowerCase()}/source.${ext}`;
}

/** Is this key one that create_upload() could have made for this owner? */
export function keyBelongsTo(key: string, ownerId: string): boolean {
  return /^uploads\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/source\.(mp4|mov|webm|mkv)$/.test(key) &&
    key.startsWith(`uploads/${ownerId.toLowerCase()}/`);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** 1536 -> "1.5 KB", using 1024 steps like the file picker does. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** Upload speed for the progress line, like "4.2 MB/s". */
export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(Math.max(0, bytesPerSecond))}/s`;
}

/** Whole percent, never 100 until every byte is in. */
export function percentDone(sent: number, total: number): number {
  if (total <= 0) return 0;
  if (sent >= total) return 100;
  return Math.min(99, Math.floor((sent / total) * 100));
}

/** Friendly text for an error code from the RPCs or the routes. */
export function uploadErrorText(code: string | null | undefined, limits: UploadLimits = DEFAULT_LIMITS): string {
  switch (code) {
    case "not_signed_in":
      return "Sign in to upload.";
    case "upload_off":
      return "Uploads are switched off right now.";
    case "not_onboarded":
      return "Finish setting up your account before you upload.";
    case "not_allowed":
      return "Uploading is limited to some accounts right now, and yours is not one of them yet.";
    case "caption_too_long":
      return `Captions can be up to ${CAPTION_MAX} characters.`;
    case "bad_visibility":
      return "Pick public or private.";
    case "file_empty":
      return "This file is empty.";
    case "file_too_big":
      return `This file is bigger than ${formatBytes(Math.min(limits.maxBytes, MAX_UPLOAD_BYTES))}, the most one clip can be.`;
    case "too_long":
      return `This clip is longer than ${limits.maxSeconds} seconds, the longest a clip can be.`;
    case "bad_type":
      return "Only MP4, MOV, WebM and MKV videos can be uploaded.";
    case "daily_limit":
      return "You have reached today's upload limit. Try again tomorrow.";
    case "not_configured":
      return "Uploads are not set up on this server yet (storage is missing).";
    case "size_mismatch":
      return "The uploaded file did not arrive complete. Try again.";
    case "banned":
      return "This account has been banned.";
    case "no_db":
      return "database not connected";
    case "storage_error":
      return "The file storage refused the upload. Check the R2 settings on the server: account id, bucket and both keys.";
    case "db_error":
      return "The database refused the upload. Check that every file in supabase/migrations has been run.";
    case "not_uploading":
      return "This upload was already finished or cancelled. Start again.";
    default:
      return "Something went wrong. Try again.";
  }
}
