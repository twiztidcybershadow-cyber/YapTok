import "server-only";
import { flagOn } from "@/lib/flags";
import { createClient } from "@/lib/supabase/server";
import { readR2Config } from "@/lib/upload/env";
import { createR2Client } from "@/lib/upload/r2";
import type { MediaContext } from "./media";
import { createMediaStorage } from "./r2";

/** The real Supabase, flag and R2 for /api/media/[video]/[...path]. */
export async function mediaContext(): Promise<MediaContext> {
  const supabase = await createClient();
  const r2 = readR2Config();
  return {
    db: supabase
      ? {
          async watchVideo(id) {
            // Null unless the person asking may see the clip (007_feed.sql).
            const { data, error } = await supabase.rpc("video_by_id", { p_video: id });
            const row = data as { status?: string; mine?: boolean; hls_key?: string | null } | null;
            if (error || !row?.status) return null;
            return { status: row.status, is_owner: row.mine === true, hls_key: row.hls_key ?? null };
          },
        }
      : null,
    flagOn: () => flagOn("feed"),
    storage: r2 ? createMediaStorage(createR2Client(r2), r2.bucket) : null,
  };
}
