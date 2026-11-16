"use client";

import Link from "next/link";
import type { AdminReport } from "@/lib/admin/types";
import { timeAgo } from "@/lib/feed/format";
import { reasonLabel } from "@/lib/social/reports";
import { Empty } from "./AdminShell";
import { ConfirmButton } from "./Confirm";
import { useAdminAction } from "./useAdminAction";

/**
 * The reports queue. Open reports, oldest first: remove what was reported
 * (which closes every report on it) or dismiss the report. The closed tab
 * shows what was decided and by whom.
 */
export function ReportsQueue({ reports, status, preview }: { reports: AdminReport[]; status: "open" | "closed"; preview: boolean }) {
  const { run, busy } = useAdminAction(preview);
  return (
    <section aria-label="Reports">
      <div className="mb-4 flex gap-2">
        {(["open", "closed"] as const).map((s) => (
          <Link key={s} href={s === "open" ? "/admin/reports" : "/admin/reports?status=closed"} prefetch={false} aria-current={status === s ? "page" : undefined} className={`pill !h-8 !px-4 !text-[13px] ${status === s ? "!bg-[var(--brand-strong)] !text-white" : ""}`}>
            {s === "open" ? "Open" : "Closed"}
          </Link>
        ))}
      </div>
      {reports.length === 0 ? (
        <Empty>{status === "open" ? "Nothing to review. The queue is empty." : "No closed reports yet."}</Empty>
      ) : (
        <ul className="space-y-3" data-report-list>
          {reports.map((r) => {
            const comment = r.targetType === "comment" ? r.comment : null;
            const gone = comment ? comment.removed : r.video.removed;
            return (
              <li key={r.id} className="card p-4" data-report={r.id}>
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-text-2">
                  <span className="pill pill-warn">{reasonLabel(r.reason)}</span>
                  <span>{comment ? "Comment" : "Clip"}</span>
                  <span>· reported by {r.reporter ? `@${r.reporter.username}` : "a deleted account"}</span>
                  <span>· {timeAgo(r.createdAt)}</span>
                  {r.status !== "open" && (
                    <span className={`pill ${r.status === "actioned" ? "pill-bad" : ""}`}>
                      {r.status === "actioned" ? "removed" : "dismissed"}
                      {r.resolvedBy && ` by @${r.resolvedBy.username}`}
                    </span>
                  )}
                </div>
                {comment ? (
                  <blockquote className="mt-3 border-l-2 border-divider pl-3 text-[14px] leading-5 text-text">
                    {comment.body}
                    <footer className="mt-1 text-[12px] text-text-2">
                      by {comment.author ? `@${comment.author.username}` : "a deleted account"} on the clip &quot;{r.video.caption || "no caption"}&quot;
                    </footer>
                  </blockquote>
                ) : (
                  <p className="mt-3 text-[14px] leading-5 text-text">
                    &quot;{r.video.caption || "no caption"}&quot; <span className="text-text-2">by {r.video.owner ? `@${r.video.owner.username}` : "a deleted account"}</span>
                  </p>
                )}
                {r.note && <p className="mt-2 text-[13px] text-text-2">Note from the reporter: {r.note}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Link href={`/v/${r.video.id}`} className="btn-ghost btn-sm" prefetch={false}>
                    View clip
                  </Link>
                  {r.status === "open" && !gone && (
                    <>
                      {comment ? (
                        <ConfirmButton label="Remove comment" confirmLabel="Remove it" disabled={busy === r.id} testId="remove" onConfirm={() => void run(r.id, "admin_remove_comment", { p_comment: comment.id }, "Comment removed")} />
                      ) : (
                        <ConfirmButton
                          label="Remove clip"
                          confirmLabel="Remove it"
                          reason="Reason (shown in the log)"
                          disabled={busy === r.id}
                          testId="remove"
                          onConfirm={(reason) => void run(r.id, "admin_remove_video", { p_video: r.video.id, p_reason: reason || reasonLabel(r.reason) }, "Clip removed")}
                        />
                      )}
                    </>
                  )}
                  {r.status === "open" && (
                    <button type="button" disabled={busy === r.id} onClick={() => void run(r.id, "admin_dismiss_report", { p_report: r.id }, "Report dismissed")} className="btn-ghost btn-sm" data-action="dismiss">
                      Dismiss
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
