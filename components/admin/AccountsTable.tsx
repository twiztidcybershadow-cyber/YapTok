"use client";

import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import type { AdminAccount } from "@/lib/admin/types";
import { compactCount, timeAgo } from "@/lib/feed/format";
import { Empty } from "./AdminShell";
import { ConfirmButton } from "./Confirm";
import { useAdminAction } from "./useAdminAction";

/**
 * Every account, newest first: ban and unban, and the two marks that decide
 * who may upload when "Who can upload" is not Everyone (verified, invited).
 */
export function AccountsTable({ accounts, preview }: { accounts: AdminAccount[]; preview: boolean }) {
  const { run, busy } = useAdminAction(preview);
  if (accounts.length === 0) return <Empty>No accounts match.</Empty>;
  return (
    <ul className="card divide-y divide-divider" data-account-list>
      {accounts.map((a) => {
        const mark = (name: "verified" | "invited", on: boolean, done: string) => void run(a.id, "admin_set_mark", { p_user: a.id, p_mark: name, p_on: on }, done);
        return (
          <li key={a.id} className="flex gap-3 p-3 sm:gap-4 sm:p-4" data-account={a.username}>
            <Avatar name={a.displayName} url={a.avatarUrl} size={40} />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-[14px] text-text">
                <Link href={`/@${a.username}`} prefetch={false} className="font-medium hover:underline">
                  @{a.username}
                </Link>
                <span className="text-text-2">{a.displayName}</span>
                {a.isAdmin && <span className="pill !bg-[var(--brand-strong)] !text-white">admin</span>}
                {a.banned && <span className="pill pill-bad">banned</span>}
                {a.verified && <span className="pill pill-ok">verified</span>}
                {a.invited && <span className="pill">invited</span>}
                {!a.onboarded && <span className="pill pill-warn">not finished signing up</span>}
              </p>
              <p className="mt-1 text-[12px] text-text-2">
                joined {timeAgo(a.createdAt)} · {compactCount(a.videoCount)} clips · {compactCount(a.followerCount)} followers
                {a.banned && a.bannedReason && ` · banned for: ${a.bannedReason}`}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" disabled={busy === a.id} onClick={() => mark("verified", !a.verified, a.verified ? "Verified mark removed" : "Account verified")} className="btn-ghost btn-sm" data-action="verify">
                  {a.verified ? "Unverify" : "Verify"}
                </button>
                <button type="button" disabled={busy === a.id} onClick={() => mark("invited", !a.invited, a.invited ? "Invite removed" : "Invited to upload")} className="btn-ghost btn-sm" data-action="invite">
                  {a.invited ? "Uninvite" : "Invite to upload"}
                </button>
                {a.banned ? (
                  <button type="button" disabled={busy === a.id} onClick={() => void run(a.id, "admin_unban", { p_user: a.id }, "Account unbanned")} className="btn-ghost btn-sm" data-action="unban">
                    Unban
                  </button>
                ) : (
                  !a.isAdmin && (
                    <ConfirmButton label="Ban" confirmLabel="Ban this account" reason="Reason (shown in the log)" disabled={busy === a.id} testId="ban" onConfirm={(reason) => void run(a.id, "admin_ban", { p_user: a.id, p_reason: reason }, "Account banned")} />
                  )
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
