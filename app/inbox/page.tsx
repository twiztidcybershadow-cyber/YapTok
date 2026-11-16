import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { DbNotConnected } from "@/components/auth/AuthCard";
import { InboxList } from "@/components/inbox/InboxList";
import { getCurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { readNotices } from "@/lib/social/inbox";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Inbox | YapTok" };

async function Inbox() {
  await connection();
  if (!readSupabaseConfig()) return <DbNotConnected />;
  const user = await getCurrentUser();
  if (!(await flagOn("inbox", user?.id ?? null))) notFound();
  if (!user) redirect("/login?next=/inbox");
  const supabase = await createClient();
  const { data } = supabase ? await supabase.rpc("inbox_page") : { data: null };
  const messagesOn = await flagOn("messages", user.id);
  const unread = messagesOn && supabase ? Number((await supabase.rpc("dm_unread")).data) || 0 : null;
  return <InboxList notices={readNotices(data)} messagesUnread={unread} />;
}

/** The activity inbox: who liked, commented, replied or followed. */
export default function InboxPage() {
  return (
    <div className="mx-auto max-w-[560px] px-4 py-6 sm:px-6">
      <h1 className="text-[24px] font-medium leading-8 text-text">Inbox</h1>
      <Suspense fallback={<div className="mt-4 h-14 rounded-xl bg-skeleton" aria-hidden />}>
        <Inbox />
      </Suspense>
    </div>
  );
}
