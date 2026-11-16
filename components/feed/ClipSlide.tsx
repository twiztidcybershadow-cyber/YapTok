"use client";

import Link from "next/link";
import type { Ref } from "react";
import { Avatar } from "@/components/Avatar";
import { BookmarkIcon, CommentIcon, HeartIcon, MoreIcon, MutedIcon, PlusIcon, ShareIcon, VerifiedIcon, VolumeIcon } from "@/components/icons";
import { compactCount, timeAgo } from "@/lib/feed/format";
import { clipSources, type Clip } from "@/lib/feed/types";
import { useFeed } from "@/lib/store/feed";
import { useFlag } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";
import { ClipPlayer, type ClipPlayerHandle } from "./ClipPlayer";
import { ClipMenu } from "./ClipMenu";
import { CommentsSheet } from "./CommentsSheet";
import { ReportSheet } from "./ReportSheet";
import { ShareSheet } from "./ShareSheet";
import { useFollow, useLike, useSave } from "./useSocial";

function RailButton({
  label,
  count,
  onClick,
  pressed,
  children,
  testId,
}: {
  label: string;
  count?: number;
  onClick: () => void;
  pressed?: boolean;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <button type="button" aria-label={label} aria-pressed={pressed} onClick={onClick} data-rail={testId} className="group flex flex-col items-center gap-1">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-black/35 backdrop-blur-sm transition-transform group-active:scale-90 desk:bg-white/10 desk:group-hover:bg-white/20">
        {children}
      </span>
      {count !== undefined && <span className="over-video text-[12px] font-medium leading-none text-white">{compactCount(count)}</span>}
    </button>
  );
}

/**
 * One clip in the feed: the video, who made it and what they wrote at the
 * bottom left, and the action rail at the right (beside the video on a desk).
 * Each action only shows while its feature flag is on.
 */
export function ClipSlide({
  clip,
  mode,
  muted,
  mediaBase,
  signedIn,
  playerRef,
  onToggleMute,
}: {
  clip: Clip;
  mode: "active" | "preload" | "poster";
  muted: boolean;
  mediaBase: string | null;
  signedIn: boolean;
  playerRef?: Ref<ClipPlayerHandle>;
  onToggleMute: () => void;
}) {
  const { src, poster } = clipSources(clip, mediaBase);
  const sheet = useFeed((s) => s.sheet);
  const openSheet = useFeed((s) => s.openSheet);
  const likes = useFlag("likes");
  const comments = useFlag("comments");
  const follows = useFlag("follows");
  const share = useFlag("share");
  const saves = useFlag("saves");
  const profiles = useFlag("profiles");
  const hashtagPages = useFlag("hashtags");
  const gestures = useFlag("gestures");
  const scrub = useFlag("scrub");
  const toggleLike = useLike(signedIn);
  const toggleSave = useSave(signedIn);
  const soundBlocked = useUi((s) => s.soundBlocked);
  const toggleFollow = useFollow(signedIn, `/v/${clip.id}`);
  const active = mode === "active";
  const profileHref = `/@${clip.author.username}`;

  const name = (
    <span className="flex items-center gap-1 text-[16px] font-bold leading-5">
      @{clip.author.username}
      {clip.author.verified && <VerifiedIcon className="h-4 w-4" />}
    </span>
  );

  return (
    <article className="flex h-full items-center justify-center" data-clip={clip.id} data-clip-mode={mode}>
      <div className="relative h-full w-full desk:my-4 desk:aspect-[9/16] desk:h-[calc(100%-32px)] desk:w-auto desk:max-w-[calc(100%-180px)] desk:overflow-visible">
        <div className="absolute inset-0 overflow-hidden bg-black desk:rounded-2xl">
          <ClipPlayer src={src} poster={poster} mode={mode} muted={muted} cover={(clip.height ?? 16) >= (clip.width ?? 9)}
            gestures={gestures}
            scrub={scrub}
            ref={playerRef}
            // A double tap only ever likes: it never takes a like back.
            onDoubleTap={likes ? () => !clip.liked && toggleLike(clip) : undefined}
            onSoundBlocked={soundBlocked}
          />
          {/* A soft shade so the text reads on any clip. */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/70 to-transparent" />

          {clip.status !== "ready" && (
            <p className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-[12px] font-medium text-white">
              {clip.status === "failed" ? "This clip failed to process" : "Still processing. Only you can see this."}
            </p>
          )}
          {clip.removed && (
            <p className="absolute left-3 top-3 rounded-full bg-[#c62828] px-3 py-1 text-[12px] font-medium text-white">
              Removed by a moderator. Only you can see this.
            </p>
          )}

          <div className="over-video pointer-events-none absolute bottom-0 left-0 right-[72px] p-4 pb-5 text-white desk:right-4">
            <div className="pointer-events-auto flex items-center gap-2">
              {profiles ? (
                <Link href={profileHref} className="hover:underline" tabIndex={active ? 0 : -1}>
                  {name}
                </Link>
              ) : (
                name
              )}
              <span className="text-[13px] text-white/75">{timeAgo(clip.publishedAt ?? clip.createdAt)}</span>
            </div>
            {clip.caption && <p className="mt-1.5 line-clamp-3 whitespace-pre-line text-[14px] leading-5">{clip.caption}</p>}
            {clip.hashtags.length > 0 && (
              <p className="pointer-events-auto mt-1 line-clamp-1 text-[14px] font-medium leading-5">
                {clip.hashtags.map((t) =>
                  hashtagPages ? (
                    <Link key={t} href={`/tag/${t}`} className="mr-2 hover:underline" tabIndex={active ? 0 : -1}>
                      #{t}
                    </Link>
                  ) : (
                    <span key={t} className="mr-2">
                      #{t}
                    </span>
                  ),
                )}
              </p>
            )}
          </div>

          {active && sheet === "comments" && <CommentsSheet clip={clip} signedIn={signedIn} />}
          {active && sheet === "share" && <ShareSheet clip={clip} signedIn={signedIn} />}
          {active && sheet === "report" && <ReportSheet target={{ type: "video", id: clip.id }} onClose={() => openSheet(null)} />}
        </div>

        {/* The action rail: over the video on a phone, beside it on a desk. */}
        <div className="absolute bottom-6 right-2 z-10 flex flex-col items-center gap-4 text-white desk:-right-[68px] desk:bottom-2" data-rail-root>
          <div className="relative mb-1">
            {profiles ? (
              <Link href={profileHref} aria-label={`${clip.author.displayName}'s profile`} tabIndex={active ? 0 : -1} className="block rounded-full ring-2 ring-white">
                <Avatar name={clip.author.displayName} url={clip.author.avatarUrl} size={48} />
              </Link>
            ) : (
              <span className="block rounded-full ring-2 ring-white">
                <Avatar name={clip.author.displayName} url={clip.author.avatarUrl} size={48} />
              </span>
            )}
            {follows && !clip.mine && !clip.following && (
              <button
                type="button"
                aria-label={`Follow ${clip.author.displayName}`}
                data-rail="follow"
                onClick={() => void toggleFollow(clip.author.id, clip.following, () => {})}
                className="absolute -bottom-2 left-1/2 grid h-6 w-6 -translate-x-1/2 place-items-center rounded-full bg-[var(--brand-strong)] text-white"
              >
                <PlusIcon className="h-4 w-4" />
              </button>
            )}
          </div>
          {likes && (
            <RailButton label={clip.liked ? "Unlike" : "Like"} pressed={clip.liked} count={clip.likeCount} onClick={() => toggleLike(clip)} testId="like">
              <HeartIcon className={`h-7 w-7 ${clip.liked ? "text-[var(--accent)]" : "text-white"}`} />
            </RailButton>
          )}
          {comments && (
            <RailButton label="Comments" count={clip.commentCount} onClick={() => openSheet(sheet === "comments" ? null : "comments")} testId="comments">
              <CommentIcon className="h-7 w-7" />
            </RailButton>
          )}
          {saves && (
            <RailButton label={clip.saved ? "Remove from saved" : "Save"} pressed={clip.saved} count={clip.saveCount} onClick={() => toggleSave(clip)} testId="save">
              <BookmarkIcon className={`h-6 w-6 ${clip.saved ? "text-[var(--accent)]" : "text-white"}`} />
            </RailButton>
          )}
          {share && (
            <RailButton label="Share" count={clip.shareCount} onClick={() => openSheet(sheet === "share" ? null : "share")} testId="share">
              <ShareIcon className="h-7 w-7" />
            </RailButton>
          )}
          <RailButton label={muted ? "Turn the sound on" : "Turn the sound off"} pressed={!muted} onClick={onToggleMute} testId="sound">
            {muted ? <MutedIcon className="h-6 w-6" /> : <VolumeIcon className="h-6 w-6" />}
          </RailButton>
          <ClipMenu clip={clip} signedIn={signedIn}>
            <MoreIcon className="h-6 w-6" />
          </ClipMenu>
        </div>
      </div>
    </article>
  );
}
