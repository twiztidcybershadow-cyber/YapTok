"use client";

import Link from "next/link";
import type { AdminVideo } from "@/lib/admin/types";
import { clipLength, compactCount, timeAgo } from "@/lib/feed/format";
import { Empty } from "./AdminShell";
import { ConfirmButton } from "./Confirm";
import { useAdminAction } from "./useAdminAction";

function StatusPill({ v }: { v: AdminVideo }) {
  if (v.removed) return <span className="pill pill-bad">removed</span>;
  if (v.status === "failed") return <span className="pill pill-bad">failed</span>;
  if (v.status !== "ready") return <span className="pill pill-warn">{v.status}</span>;
  if (v.visibility === "private") return <span className="pill">private</span>;
  return <span className="pill pill-ok">live</span>;
}

/** Every clip, newest first: remove one from the site (it can be restored) or bring it back. */
export function VideosTable({ videos, preview }: { videos: AdminVideo[]; preview: boolean }) {
  const { run, busy } = useAdminAction(preview);
  if (videos.length === 0) return <Empty>No clips match.</Empty>;
  return (
    <ul className="card divide-y divide-divider" data-video-list>
      {videos.map((v) => (
        <li key={v.id} className="flex gap-3 p-3 sm:gap-4 sm:p-4" data-video={v.id}>
          <div className="h-[96px] w-[54px] shrink-0 overflow-hidden rounded-md bg-skeleton">
            {v.thumbnailUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- covers come from the media bucket, whose address is only known at request time
              <img src={v.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[14px] leading-5 text-text">{v.caption || <span className="text-text-3">no caption</span>}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-text-2">
              <StatusPill v={v} />
              {v.openReports > 0 && (
                <span className="pill pill-warn">
                  {v.openReports} open report{v.openReports === 1 ? "" : "s"}
                </span>
              )}
              <span>{v.owner ? `@${v.owner.username}` : "deleted account"}</span>
              <span>· {timeAgo(v.createdAt)}</span>
              {v.durationS !== null && <span>· {clipLength(v.durationS)}</span>}
              <span>· {compactCount(v.viewCount)} views</span>
              <span>· {compactCount(v.likeCount)} likes</span>
            </p>
            {v.removed && v.removedReason && <p className="mt-1 text-[12px] text-text-2">Reason: {v.removedReason}</p>}
            {v.status === "failed" && v.error && <p className="mt-1 text-[12px] text-error">{v.error}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              <Link href={`/v/${v.id}`} prefetch={false} className="btn-ghost btn-sm">
                View
              </Link>
              {v.removed ? (
                <button type="button" disabled={busy === v.id} onClick={() => void run(v.id, "admin_restore_video", { p_video: v.id }, "Clip restored")} className="btn-ghost btn-sm" data-action="restore">
                  Restore
                </button>
              ) : (
                <ConfirmButton label="Remove" confirmLabel="Remove it" reason="Reason (shown in the log)" disabled={busy === v.id} testId="remove" onConfirm={(reason) => void run(v.id, "admin_remove_video", { p_video: v.id, p_reason: reason }, "Clip removed")} />
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
