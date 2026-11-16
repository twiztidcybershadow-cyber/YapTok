import { Suspense } from "react";
import { FeedSkeleton } from "@/components/feed/FeedNotice";
import { HomeFeed } from "@/components/feed/HomeFeed";

export const metadata = { title: "Following | YapTok" };

/** The Following feed: clips from the creators you follow. */
export default function FollowingPage() {
  return (
    <Suspense fallback={<FeedSkeleton />}>
      <HomeFeed source="following_page" />
    </Suspense>
  );
}
