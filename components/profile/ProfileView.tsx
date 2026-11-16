"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { useFollow } from "@/components/feed/useSocial";
import { ClipGrid } from "@/components/feed/ClipGrid";
import { ClipIcon, VerifiedIcon } from "@/components/icons";
import { compactCount } from "@/lib/feed/format";
import type { Profile, ProfileTab } from "@/lib/feed/server";
import type { Clip } from "@/lib/feed/types";
import { useFlag } from "@/lib/store/session";

function Stat({ value, label, href }: { value: number; label: string; href?: string }) {
  const body = (
    <>
      <p className="text-[18px] font-bold leading-6 text-text">{compactCount(value)}</p>
      <p className="text-[13px] text-text-2">{label}</p>
    </>
  );
  if (href) {
    return (
      <Link href={href} prefetch={false} className="rounded-lg px-1 text-center hover:bg-hover" data-stat-link={label}>
        {body}
      </Link>
    );
  }
  return (
    <div className="text-center">
      <p className="text-[18px] font-bold leading-6 text-text">{compactCount(value)}</p>
      <p className="text-[13px] text-text-2">{label}</p>
    </div>
  );
}

/** What the owner sees on a clip of theirs that visitors cannot see. */
function ownerNote(clip: Clip): string | null {
  if (clip.removed) return "Removed";
  if (clip.status === "failed") return "Failed";
  if (clip.status !== "ready") return "Processing";
  if (clip.visibility === "private") return "Private";
  return null;
}

/** A creator's page: who they are, their counts, follow, and a grid of their clips. */
export function ProfileView({
  profile,
  clips,
  following: followingAtLoad,
  mine,
  mediaBase,
  signedIn,
  tab = "clips",
  tabsOn = false,
}: {
  profile: Profile;
  clips: Clip[];
  following: boolean;
  mine: boolean;
  mediaBase: string | null;
  signedIn: boolean;
  tab?: ProfileTab;
  /** The owner's Liked and Saved tabs. */
  tabsOn?: boolean;
}) {
  const follows = useFlag("follows");
  const upload = useFlag("upload");
  const lists = useFlag("follow_lists");
  const messagesOn = useFlag("messages");
  const [following, setFollowing] = useState(followingAtLoad);
  const [followers, setFollowers] = useState(profile.followerCount);
  const toggleFollow = useFollow(signedIn, `/@${profile.username}`);

  return (
    <div className="mx-auto max-w-[960px] px-4 py-6 sm:px-6" data-profile={profile.username}>
      <header className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:gap-6 sm:text-left">
        <Avatar name={profile.displayName} url={profile.avatarUrl} size={96} />
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center justify-center gap-1.5 text-[24px] font-bold leading-8 text-text sm:justify-start">
            <span className="truncate">{profile.displayName}</span>
            {profile.verified && <VerifiedIcon className="h-5 w-5 shrink-0" />}
          </h1>
          <p className="text-[15px] text-text-2">@{profile.username}</p>
          {profile.bio && <p className="mt-2 whitespace-pre-line text-[14px] leading-5 text-text">{profile.bio}</p>}
          <div className="mt-4 flex justify-center gap-8 sm:justify-start">
            <Stat value={profile.followingCount} label="Following" href={lists ? `/@${profile.username}/following` : undefined} />
            <Stat value={followers} label="Followers" href={lists ? `/@${profile.username}/followers` : undefined} />
            <Stat value={profile.likeCount} label="Likes" />
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {!mine && messagesOn && signedIn && !profile.banned && (
            <Link href={`/messages/${profile.username}`} prefetch={false} className="btn-ghost" data-message-button>
              Message
            </Link>
          )}
          {mine ? (
            <Link href="/settings" className="btn-ghost">
              Edit profile
            </Link>
          ) : (
            follows &&
            !profile.banned && (
              <button
                type="button"
                data-follow
                aria-pressed={following}
                onClick={() =>
                  void toggleFollow(profile.id, following, (now, count) => {
                    setFollowing(now);
                    setFollowers((c) => count ?? Math.max(0, c + (now ? 1 : -1)));
                  })
                }
                className={following ? "btn-ghost min-w-[120px]" : "btn-primary min-w-[120px]"}
              >
                {following ? "Following" : "Follow"}
              </button>
            )
          )}
        </div>
      </header>

      {tabsOn && (
        <nav aria-label="Your lists" className="mt-6 flex justify-center gap-1 border-b border-divider sm:justify-start" data-profile-tabs>
          {([
            ["clips", "Clips"],
            ["liked", "Liked"],
            ["saved", "Saved"],
          ] as const).map(([key, label]) => (
            <Link
              key={key}
              href={key === "clips" ? `/@${profile.username}` : `/@${profile.username}?tab=${key}`}
              prefetch={false}
              aria-current={tab === key ? "page" : undefined}
              className={`-mb-px border-b-2 px-4 py-2.5 text-[14px] font-medium ${tab === key ? "border-[var(--brand)] text-text" : "border-transparent text-text-2 hover:text-text"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
      )}
      {tabsOn && tab !== "clips" && <p className="mt-3 text-[13px] text-text-2">Only you can see this list.</p>}

      {profile.banned ? (
        <p className="mt-10 text-center text-[14px] text-text-2" data-profile-banned>
          This account has been banned for breaking the rules.
        </p>
      ) : clips.length === 0 ? (
        <div className="mt-12 text-center" data-profile-empty>
          <ClipIcon className="mx-auto h-12 w-12 text-text-3" />
          <p className="mt-3 text-[16px] font-medium text-text">
            {tab === "liked" ? "No liked clips yet" : tab === "saved" ? "Nothing saved yet" : mine ? "Post your first clip" : "No clips yet"}
          </p>
          <p className="mt-1 text-[14px] text-text-2">
            {tab === "liked"
              ? "Clips you like show up here."
              : tab === "saved"
                ? "Tap the bookmark on a clip to keep it here."
                : mine
                  ? "Your clips will show up here."
                  : "When this creator posts, their clips show up here."}
          </p>
          {mine && upload && tab === "clips" && (
            <Link href="/upload" className="btn-primary mt-4">
              Upload
            </Link>
          )}
        </div>
      ) : (
        <div className="mt-8">
          <ClipGrid clips={clips} mediaBase={mediaBase} note={mine && tab === "clips" ? ownerNote : undefined} />
        </div>
      )}
    </div>
  );
}
