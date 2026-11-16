import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FeedSkeleton } from "@/components/feed/FeedNotice";
import { HomeFeed } from "@/components/feed/HomeFeed";
import { clipState } from "@/lib/feed/server";
import { siteConfig } from "@/site.config";

/** The title and share card of one clip. */
export async function generateMetadata({ params }: PageProps<"/v/[id]">): Promise<Metadata> {
  const state = await clipState((await params).id);
  if (state.kind !== "found") return { title: siteConfig.siteName };
  const { clip } = state;
  const title = `${clip.caption.slice(0, 60) || "A clip"} | @${clip.author.username} on ${siteConfig.siteName}`;
  return {
    title,
    description: clip.caption || siteConfig.description,
    openGraph: { title, description: clip.caption || siteConfig.description, type: "video.other", images: clip.thumbnailUrl ? [clip.thumbnailUrl] : [] },
  };
}

async function ClipFeed({ params }: { params: PageProps<"/v/[id]">["params"] }) {
  const { id } = await params;
  const state = await clipState(id);
  // A clip that is gone (or was never there) is a real 404, not an empty feed.
  if (state.kind === "missing") notFound();
  return <HomeFeed first={id} />;
}

/** One clip by its link. It plays first; swiping up continues into the feed. */
export default function ClipPage({ params }: PageProps<"/v/[id]">) {
  return (
    <Suspense fallback={<FeedSkeleton />}>
      <ClipFeed params={params} />
    </Suspense>
  );
}
