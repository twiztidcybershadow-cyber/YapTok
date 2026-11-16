import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ThreadView } from "@/components/messages/ThreadView";
import { getCurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { readThread } from "@/lib/social/messages";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Messages | YapTok" };

async function Conversation({ params }: { params: PageProps<"/messages/[username]">["params"] }) {
  await connection();
  const { username } = await params;
  const user = await getCurrentUser();
  if (!(await flagOn("messages", user?.id ?? null)) || !/^[A-Za-z0-9_]{3,24}$/.test(username)) notFound();
  if (!user) redirect(`/login?next=/messages/${username}`);
  const supabase = await createClient();
  // Null: no such account, or it is you.
  const thread = readThread(supabase ? (await supabase.rpc("dm_thread", { p_username: username })).data : null);
  if (!thread) notFound();
  return <ThreadView person={thread.with} initial={thread.messages} />;
}

/** One conversation. */
export default function ConversationPage({ params }: PageProps<"/messages/[username]">) {
  return (
    <Suspense fallback={<div className="mx-auto mt-6 h-12 max-w-[608px] rounded-xl bg-skeleton" aria-hidden />}>
      <Conversation params={params} />
    </Suspense>
  );
}
