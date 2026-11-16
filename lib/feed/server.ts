import "server-only";
import { connection } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { readPublicBase } from "@/lib/media/media";
import { FEED_PAGE } from "./nav";
import { readAuthor, readClip, readClips, type Clip, type ClipAuthor } from "./types";

/** MEDIA_PUBLIC_URL, read at request time like the other settings. */
export function mediaBase(): string | null {
  const env = process.env;
  return readPublicBase(env["MEDIA_PUBLIC_URL"]);
}

export type FeedState =
  | { kind: "no-db" }
  /** The feed flag is off for this person. */
  | { kind: "off" }
  /** The feed could not be read: the migrations are not applied yet. */
  | { kind: "not-set-up" }
  | { kind: "ready"; clips: Clip[]; mediaBase: string | null; signedIn: boolean; followingOn: boolean };

/** Which feed: everyone's clips, or the clips of the creators the person follows. */
export type FeedSource = "feed_page" | "following_page";

/** The first page of a feed. Reads the request, so call it inside <Suspense>. */
export async function feedState(first?: string, source: FeedSource = "feed_page"): Promise<FeedState> {
  await connection();
  if (!readSupabaseConfig()) return { kind: "no-db" };
  const user = await getCurrentUser();
  if (!(await flagOn("feed", user?.id ?? null))) return { kind: "off" };
  const supabase = await createClient();
  if (!supabase) return { kind: "no-db" };

  const [{ data, error }, one] = await Promise.all([
    // A signed out visitor has no Following feed: an empty page, and the page says why.
    source === "following_page" && !user ? Promise.resolve({ data: [], error: null }) : supabase.rpc(source, { p_limit: FEED_PAGE }),
    first ? supabase.rpc("video_by_id", { p_video: first }) : Promise.resolve({ data: null }),
  ]);
  if (error) return { kind: "not-set-up" };
  let clips = readClips(data);
  // /v/<id>: that clip first, then the feed without it.
  const lead = readClip(one.data);
  if (lead) clips = [lead, ...clips.filter((c) => c.id !== lead.id)];
  const followingOn = (await flagOn("following", user?.id ?? null)) && (await flagOn("follows", user?.id ?? null));
  return { kind: "ready", clips, mediaBase: mediaBase(), signedIn: user !== null, followingOn };
}

export type ClipState =
  | { kind: "no-db" }
  | { kind: "off" }
  | { kind: "missing" }
  | { kind: "found"; clip: Clip };

/** One clip for /v/<id>: its title and share card, and whether it exists at all. */
export async function clipState(id: string): Promise<ClipState> {
  await connection();
  if (!readSupabaseConfig()) return { kind: "no-db" };
  const user = await getCurrentUser();
  if (!(await flagOn("feed", user?.id ?? null))) return { kind: "off" };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return { kind: "missing" };
  const supabase = await createClient();
  if (!supabase) return { kind: "no-db" };
  const { data } = await supabase.rpc("video_by_id", { p_video: id.toLowerCase() });
  const clip = readClip(data);
  return clip ? { kind: "found", clip } : { kind: "missing" };
}

export type Profile = ClipAuthor & {
  bio: string;
  banned: boolean;
  followerCount: number;
  followingCount: number;
  videoCount: number;
  likeCount: number;
};

export type ProfileState =
  | { kind: "no-db" }
  | { kind: "off" }
  | { kind: "missing" }
  | {
      kind: "found";
      profile: Profile;
      clips: Clip[];
      following: boolean;
      mine: boolean;
      mediaBase: string | null;
      signedIn: boolean;
      /** Which list is shown. Liked and Saved are only for the owner, with the saves flag on. */
      tab: ProfileTab;
      tabsOn: boolean;
    };

export type ProfileTab = "clips" | "liked" | "saved";

const n = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));

/** A creator and their clips for /@username. */
export async function profileState(username: string, wanted: ProfileTab = "clips"): Promise<ProfileState> {
  await connection();
  if (!readSupabaseConfig()) return { kind: "no-db" };
  const user = await getCurrentUser();
  if (!(await flagOn("profiles", user?.id ?? null))) return { kind: "off" };
  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) return { kind: "missing" };
  const supabase = await createClient();
  if (!supabase) return { kind: "no-db" };
  const { data } = await supabase.rpc("profile_page", { p_username: username });
  const page = data as { profile?: Record<string, unknown>; videos?: unknown; following?: boolean; mine?: boolean } | null;
  const author = readAuthor(page?.profile);
  if (!page?.profile || !author) return { kind: "missing" };
  const p = page.profile;
  const mine = page.mine === true;
  const tabsOn = mine && (await flagOn("saves", user?.id ?? null));
  const tab: ProfileTab = tabsOn ? wanted : "clips";
  // The owner's private lists come from my_clips(), which only ever answers the caller's own.
  const listed = tab === "clips" ? page.videos : (await supabase.rpc("my_clips", { p_kind: tab })).data;
  return {
    kind: "found",
    profile: {
      ...author,
      bio: typeof p.bio === "string" ? p.bio : "",
      banned: p.banned === true,
      followerCount: n(p.follower_count),
      followingCount: n(p.following_count),
      videoCount: n(p.video_count),
      likeCount: n(p.like_count),
    },
    clips: readClips(listed),
    following: page.following === true,
    mine,
    tab,
    tabsOn,
    mediaBase: mediaBase(),
    signedIn: user !== null,
  };
}
