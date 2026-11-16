import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Avatar } from "@/components/Avatar";
import { VerifiedIcon } from "@/components/icons";
import { readCreators } from "@/lib/discover/types";
import { compactCount } from "@/lib/feed/format";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Followers | YapTok" };

async function People({ params }: { params: PageProps<"/u/[handle]/[list]">["params"] }) {
  await connection();
  const { handle, list } = await params;
  if ((list !== "followers" && list !== "following") || !/^[A-Za-z0-9_]{3,24}$/.test(handle)) notFound();
  const supabase = await createClient();
  // Null: no database, the flag is off, or no such account. All the same page to a visitor.
  const data = supabase ? ((await supabase.rpc("follow_list", { p_username: handle, p_kind: list })).data as { username?: string; people?: unknown } | null) : null;
  if (!data?.username) notFound();
  const people = readCreators(data.people);
  const tab = (kind: string, label: string) => (
    <Link
      href={`/@${data.username}/${kind}`}
      prefetch={false}
      aria-current={list === kind ? "page" : undefined}
      className={`-mb-px border-b-2 px-4 py-2.5 text-[14px] font-medium ${list === kind ? "border-[var(--brand)] text-text" : "border-transparent text-text-2 hover:text-text"}`}
    >
      {label}
    </Link>
  );
  return (
    <div className="mx-auto max-w-[560px] px-4 py-6 sm:px-6" data-follow-list={list}>
      <Link href={`/@${data.username}`} className="text-[14px] text-text-2 hover:underline">
        Back to @{data.username}
      </Link>
      <nav aria-label="Lists" className="mt-3 flex border-b border-divider">
        {tab("followers", "Followers")}
        {tab("following", "Following")}
      </nav>
      {people.length === 0 ? (
        <p className="mt-12 text-center text-[14px] text-text-2">{list === "followers" ? "No followers yet." : "Not following anyone yet."}</p>
      ) : (
        <ul className="mt-2 divide-y divide-divider">
          {people.map((p) => (
            <li key={p.id}>
              <Link href={`/@${p.username}`} prefetch={false} className="flex items-center gap-3 py-3 hover:bg-hover">
                <Avatar name={p.displayName} url={p.avatarUrl} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 text-[15px] font-medium text-text">
                    <span className="truncate">{p.displayName}</span>
                    {p.verified && <VerifiedIcon className="h-4 w-4 shrink-0" />}
                  </span>
                  <span className="block truncate text-[13px] text-text-2">
                    @{p.username} · {compactCount(p.followerCount)} followers
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Who follows a creator, or who they follow, at /@username/followers and /@username/following. */
export default function FollowListPage({ params }: PageProps<"/u/[handle]/[list]">) {
  return (
    <Suspense fallback={<div className="mx-auto mt-10 h-10 max-w-[528px] rounded-xl bg-skeleton" aria-hidden />}>
      <People params={params} />
    </Suspense>
  );
}
