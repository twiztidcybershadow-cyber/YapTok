// A clip as the app shows it: what video_card() in 007_feed.sql answers,
// checked field by field so a surprise from the database cannot break a page.
// No imports on purpose, so `node --test` can load it directly.

export type ClipAuthor = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  verified: boolean;
};

export type ClipStatus = "uploading" | "uploaded" | "processing" | "ready" | "failed";

export type Clip = {
  id: string;
  caption: string;
  hashtags: string[];
  visibility: "public" | "private";
  status: ClipStatus;
  durationS: number | null;
  width: number | null;
  height: number | null;
  hlsKey: string | null;
  thumbnailUrl: string | null;
  likeCount: number;
  commentCount: number;
  viewCount: number;
  shareCount: number;
  saveCount: number;
  publishedAt: string | null;
  createdAt: string;
  /** Removed by an admin. Only the owner ever gets such a clip back. */
  removed: boolean;
  author: ClipAuthor;
  /** What the person asking has done. Always false for a signed out visitor. */
  liked: boolean;
  following: boolean;
  saved: boolean;
  mine: boolean;
};

const STATUSES = ["uploading", "uploaded", "processing", "ready", "failed"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const count = (v: unknown): number => Math.max(0, Math.floor(Number(v) || 0));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

export function readAuthor(value: unknown): ClipAuthor | null {
  const a = rec(value);
  if (!a || !UUID.test(str(a.id)) || !str(a.username)) return null;
  return {
    id: str(a.id),
    username: str(a.username),
    displayName: str(a.display_name) || str(a.username),
    avatarUrl: strOrNull(a.avatar_url),
    verified: a.verified === true,
  };
}

/** One row of feed_page(), video_by_id() or profile_page(), or null when it is not a clip. */
export function readClip(value: unknown): Clip | null {
  const r = rec(value);
  if (!r || !UUID.test(str(r.id))) return null;
  const author = readAuthor(r.author);
  if (!author) return null;
  return {
    id: str(r.id).toLowerCase(),
    caption: str(r.caption),
    hashtags: Array.isArray(r.hashtags) ? r.hashtags.filter((t): t is string => typeof t === "string") : [],
    visibility: r.visibility === "private" ? "private" : "public",
    status: STATUSES.includes(str(r.status)) ? (str(r.status) as ClipStatus) : "failed",
    durationS: numOrNull(r.duration_s),
    width: numOrNull(r.width),
    height: numOrNull(r.height),
    hlsKey: strOrNull(r.hls_key),
    thumbnailUrl: strOrNull(r.thumbnail_url),
    likeCount: count(r.like_count),
    commentCount: count(r.comment_count),
    viewCount: count(r.view_count),
    shareCount: count(r.share_count),
    saveCount: count(r.save_count),
    publishedAt: strOrNull(r.published_at),
    createdAt: str(r.created_at),
    removed: r.removed === true,
    author,
    liked: r.liked === true,
    following: r.following === true,
    saved: r.saved === true,
    mine: r.mine === true,
  };
}

/** A whole page: the rows that are clips, in the order they came. */
export function readClips(value: unknown): Clip[] {
  if (!Array.isArray(value)) return [];
  return value.map(readClip).filter((c): c is Clip => c !== null);
}

/**
 * Where the player gets a clip from: straight from the bucket's public
 * address when there is one (MEDIA_PUBLIC_URL), else through /api/media,
 * which checks who is asking and signs short lived links.
 */
export function clipSources(
  clip: Pick<Clip, "id" | "hlsKey" | "thumbnailUrl" | "status">,
  mediaBase: string | null,
): { src: string | null; poster: string | null } {
  if (clip.status !== "ready" || !clip.hlsKey) return { src: null, poster: clip.thumbnailUrl };
  const slash = clip.hlsKey.lastIndexOf("/");
  const folder = slash > 0 ? clip.hlsKey.slice(0, slash) : `hls/${clip.id}`;
  const file = slash > 0 ? clip.hlsKey.slice(slash + 1) : "master.m3u8";
  if (mediaBase) {
    return { src: `${mediaBase}/${folder}/${file}`, poster: clip.thumbnailUrl ?? `${mediaBase}/${folder}/thumb-1.webp` };
  }
  const base = `/api/media/${clip.id}`;
  return { src: `${base}/${file}`, poster: clip.thumbnailUrl ?? `${base}/thumb-1.webp` };
}

/** The page cursor after these clips, for feed_page(p_before, p_before_id). */
export function feedCursor(clips: Clip[]): { before: string; beforeId: string } | null {
  const last = clips[clips.length - 1];
  return last?.publishedAt ? { before: last.publishedAt, beforeId: last.id } : null;
}

/** Adds a page to the list without repeating a clip that is already in it. */
export function mergeClips(have: Clip[], more: Clip[]): Clip[] {
  const seen = new Set(have.map((c) => c.id));
  return [...have, ...more.filter((c) => !seen.has(c.id))];
}
