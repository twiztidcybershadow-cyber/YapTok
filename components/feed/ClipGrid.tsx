import Link from "next/link";
import { PlayIcon } from "@/components/icons";
import { clipLength, compactCount } from "@/lib/feed/format";
import { clipSources, type Clip } from "@/lib/feed/types";

/**
 * A grid of clip covers (a profile, a hashtag page, search results). Each
 * opens the clip in the player. `note` puts a small label on a clip, like
 * "Private" on the owner's own grid.
 */
export function ClipGrid({ clips, mediaBase, note }: { clips: Clip[]; mediaBase: string | null; note?: (clip: Clip) => string | null }) {
  return (
    <ul className="grid grid-cols-3 gap-1 sm:grid-cols-4 sm:gap-2 lg:grid-cols-5" data-profile-grid data-clip-grid>
      {clips.map((clip) => {
        const { poster } = clipSources(clip, mediaBase);
        const label = note?.(clip) ?? null;
        return (
          <li key={clip.id}>
            <Link href={`/v/${clip.id}`} className="group relative block aspect-[9/16] overflow-hidden rounded-lg bg-skeleton" aria-label={clip.caption || "Clip"}>
              {poster && clip.status === "ready" && (
                // eslint-disable-next-line @next/next/no-img-element -- covers come from the media bucket, whose address is only known at request time
                <img src={poster} alt="" loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
              )}
              <span className="over-video absolute bottom-1 left-1.5 flex items-center gap-0.5 text-[12px] font-medium text-white">
                <PlayIcon className="h-3.5 w-3.5" />
                {compactCount(clip.viewCount)}
              </span>
              {clip.durationS !== null && (
                <span className="over-video absolute bottom-1 right-1.5 text-[12px] font-medium text-white">{clipLength(clip.durationS)}</span>
              )}
              {label && <span className="pill absolute left-1.5 top-1.5 !bg-black/70 !text-white">{label}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
