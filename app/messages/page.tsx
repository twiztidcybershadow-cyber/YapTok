import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { DbNotConnected } from "@/components/auth/AuthCard";
import { Avatar } from "@/components/Avatar";
import { getCurrentUser } from "@/lib/auth";
import { timeAgo } from "@/lib/feed/format";
import { flagOn } from "@/lib/flags";
import { previewText, readThreads } from "@/lib/social/messages";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Messages | YapTok" };

async function Threads() {
  await connection();
  if (!readSupabaseConfig()) return <DbNotConnected />;
  const user = await getCurrentUser();
  if (!(await flagOn("messages", user?.id ?? null))) notFound();
  if (!user) redirect("/login?next=/messages");
  const supabase = await createClient();
  const threads = readThreads(supabase ? (await supabase.rpc("dm_threads")).data : null);
  if (threads.length === 0) {
    return (
      <div className="mt-16 text-center" data-threads-empty>
        <p className="text-[16px] font-medium text-text">No messages yet</p>
        <p className="mt-1 text-[14px] text-text-2">Open a creator&apos;s page and tap Message, or send a clip from the share button.</p>
      </div>
    );
  }
  return (
    <ul className="mt-2 divide-y divide-divider" data-threads>
      {threads.map((t) => (
        <li key={t.with.id}>
          <Link href={`/messages/${t.with.username}`} prefetch={false} className="flex items-center gap-3 py-3 hover:bg-hover">
            <Avatar name={t.with.displayName} url={t.with.avatarUrl} size={48} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[15px] font-medium text-text">{t.with.displayName}</span>
                <span className="shrink-0 text-[12px] text-text-3">{timeAgo(t.last.createdAt)}</span>
              </span>
              <span className={`block truncate text-[14px] ${t.unread > 0 ? "font-medium text-text" : "text-text-2"}`}>{previewText(t.last)}</span>
            </span>
            {t.unread > 0 && (
              <span data-thread-unread className="grid h-5 min-w-5 place-items-center rounded-full bg-[var(--accent)] px-1.5 text-[11px] font-bold text-black">
                {t.unread}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Your conversations, newest first. */
export default function MessagesPage() {
  return (
    <div className="mx-auto max-w-[560px] px-4 py-6 sm:px-6">
      <h1 className="text-[24px] font-medium leading-8 text-text">Messages</h1>
      <Suspense fallback={<div className="mt-4 h-14 rounded-xl bg-skeleton" aria-hidden />}>
        <Threads />
      </Suspense>
    </div>
  );
}
