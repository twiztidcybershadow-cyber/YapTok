import { Suspense } from "react";
import { FeedSkeleton } from "@/components/feed/FeedNotice";
import { HomeFeed } from "@/components/feed/HomeFeed";

/** The For You feed. */
export default function HomePage() {
  return (
    <Suspense fallback={<FeedSkeleton />}>
      <HomeFeed />
    </Suspense>
  );
}
