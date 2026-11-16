import { serveMedia } from "@/lib/media/media";
import { mediaContext } from "@/lib/media/server";

// The player's files for one clip, from the private R2 bucket (used when
// MEDIA_PUBLIC_URL is not set).
//   playlists (.m3u8) and the sprite .vtt: read from R2 and sent as they are,
//     with every URI in a playlist pointed back at this route
//   segments, init files and images: a 302 to a presigned R2 link (10 minutes)
// Only for people who may see the clip. See serveMedia in lib/media/media.ts.
export async function GET(_request: Request, ctx: RouteContext<"/api/media/[video]/[...path]">) {
  const { video, path } = await ctx.params;
  const result = await serveMedia(video, path, await mediaContext());
  return new Response(result.body, { status: result.status, headers: result.headers });
}
