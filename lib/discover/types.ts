// What the hashtag, search and Discover pages read from 013_discover.sql.
// No imports besides the clip reader, so the tests load it directly.
import { readAuthor, readClips, type Clip, type ClipAuthor } from "../feed/types.ts";

export type TagCount = { tag: string; clips: number };
export type Creator = ClipAuthor & { followerCount: number; videoCount: number };

export type SearchResults = { q: string; people: Creator[]; tags: TagCount[]; clips: Clip[] };
export type DiscoverData = { tags: TagCount[]; creators: Creator[]; clips: Clip[] };
export type TagPage = { tag: string; clipCount: number; viewCount: number; clips: Clip[] };

const n = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function readTags(v: unknown): TagCount[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((row) => {
    const r = rec(row);
    return r && typeof r.tag === "string" && /^[a-z0-9_]{1,30}$/.test(r.tag) ? [{ tag: r.tag, clips: n(r.clips) }] : [];
  });
}

export function readCreators(v: unknown): Creator[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((row) => {
    const author = readAuthor(row);
    const r = rec(row);
    return author && r ? [{ ...author, followerCount: n(r.follower_count), videoCount: n(r.video_count) }] : [];
  });
}

export function readSearch(v: unknown): SearchResults | null {
  const r = rec(v);
  if (!r) return null;
  return { q: typeof r.q === "string" ? r.q : "", people: readCreators(r.people), tags: readTags(r.tags), clips: readClips(r.clips) };
}

export function readDiscover(v: unknown): DiscoverData | null {
  const r = rec(v);
  if (!r) return null;
  return { tags: readTags(r.tags), creators: readCreators(r.creators), clips: readClips(r.clips) };
}

export function readTagPage(v: unknown): TagPage | null {
  const r = rec(v);
  if (!r || typeof r.tag !== "string") return null;
  return { tag: r.tag, clipCount: n(r.clip_count), viewCount: n(r.view_count), clips: readClips(r.videos) };
}

/** What a person typed in the search box, as the page shows and sends it: trimmed, one line, at most 60 characters. */
export function cleanQuery(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 60) : "";
}

/** "#Cats" or "cats" from an address to the hashtag it means, or null when it cannot be one. */
export function cleanTag(value: string): string | null {
  const tag = decodeURIComponent(value).replace(/^#+/, "").toLowerCase();
  return /^[a-z0-9_]{1,30}$/.test(tag) ? tag : null;
}
