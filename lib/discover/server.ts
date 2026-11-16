import "server-only";
import { connection } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { mediaBase } from "@/lib/feed/server";
import { flagOn } from "@/lib/flags";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { cleanQuery, cleanTag, readDiscover, readSearch, readTagPage, type DiscoverData, type SearchResults, type TagPage } from "./types";

export type TagState =
  | { kind: "no-db" }
  | { kind: "off" }
  | { kind: "missing" }
  | { kind: "found"; page: TagPage; mediaBase: string | null };

/** One hashtag's page. Reads the request, so call it inside <Suspense>. */
export async function tagState(raw: string): Promise<TagState> {
  await connection();
  if (!readSupabaseConfig()) return { kind: "no-db" };
  const user = await getCurrentUser();
  if (!(await flagOn("hashtags", user?.id ?? null))) return { kind: "off" };
  const tag = cleanTag(raw);
  const supabase = await createClient();
  if (!tag || !supabase) return { kind: "missing" };
  const page = readTagPage((await supabase.rpc("hashtag_page", { p_tag: tag })).data);
  return page ? { kind: "found", page, mediaBase: mediaBase() } : { kind: "missing" };
}

export type SearchState =
  | { kind: "no-db" }
  | { kind: "off" }
  /** results: for the text typed. discover: what is popular, shown before anything is typed (null while its flag is off). */
  | { kind: "ready"; q: string; results: SearchResults | null; discover: DiscoverData | null; mediaBase: string | null; tagsOn: boolean };

/** The search page: results for ?q=, or Discover when nothing is typed. */
export async function searchState(rawQ: unknown): Promise<SearchState> {
  await connection();
  if (!readSupabaseConfig()) return { kind: "no-db" };
  const user = await getCurrentUser();
  const id = user?.id ?? null;
  if (!(await flagOn("search", id))) return { kind: "off" };
  const supabase = await createClient();
  if (!supabase) return { kind: "no-db" };
  const q = cleanQuery(rawQ);
  const [results, discover, tagsOn] = await Promise.all([
    q.length >= 2 ? supabase.rpc("search_all", { p_q: q }).then((r) => readSearch(r.data)) : null,
    q.length < 2 && (await flagOn("discover", id)) ? supabase.rpc("discover_page").then((r) => readDiscover(r.data)) : null,
    flagOn("hashtags", id),
  ]);
  return { kind: "ready", q, results, discover, mediaBase: mediaBase(), tagsOn };
}
