import { notFound } from "next/navigation";
import { Feed } from "@/components/feed/Feed";
import { FeedNotice } from "@/components/feed/FeedNotice";
import { getCurrentUser } from "@/lib/auth";
import { feedState, type FeedSource } from "@/lib/feed/server";
import { FeedTabs } from "./FeedTabs";
import { flagOn } from "@/lib/flags";

/**
 * A feed, or the notice that says why there is none. `first` puts one clip at
 * the top (/v/<id>); `source` picks For You or Following.
 */
export async function HomeFeed({ first, source = "feed_page" }: { first?: string; source?: FeedSource }) {
  const state = await feedState(first, source);
  if (state.kind === "no-db") {
    return (
      <FeedNotice state="no-db" title="database not connected">
        YapTok needs a Supabase project to show clips. Add its address and publishable key to <code>.env.local</code> (see{" "}
        <code>.env.example</code>) and restart.
      </FeedNotice>
    );
  }
  if (state.kind === "off") {
    // An off feature leaves no trace: a clip or Following address is not found,
    // and the home page is the bare mark with no words about a feed.
    if (first || source === "following_page") notFound();
    return <FeedNotice state="off" />;
  }
  if (state.kind === "not-set-up") {
    return (
      <FeedNotice state="not-set-up" title="Almost there.">
        The database is connected but the feed could not be read. Run the files in <code>supabase/migrations</code> and reload.
      </FeedNotice>
    );
  }
  const tabs = state.followingOn ? <FeedTabs current={source === "following_page" ? "following" : "foryou"} /> : null;
  if (source === "following_page") {
    if (!state.followingOn) notFound();
    if (!state.signedIn) {
      return (
        <>
          {tabs}
          <FeedNotice state="following-signed-out" title="Your Following feed" action={{ href: "/login?next=/following", label: "Sign in" }}>
            Sign in to see clips from the creators you follow.
          </FeedNotice>
        </>
      );
    }
    if (state.clips.length === 0) {
      return (
        <>
          {tabs}
          <FeedNotice state="following-empty" title="Nothing here yet." action={{ href: "/", label: "Find creators in For You" }}>
            Follow a few creators and their new clips show up here.
          </FeedNotice>
        </>
      );
    }
  }
  if (state.clips.length === 0) {
    const user = await getCurrentUser();
    const canUpload = await flagOn("upload", user?.id ?? null);
    return (
      <FeedNotice
        state="empty"
        title="No clips yet."
        action={canUpload ? { href: user ? "/upload" : "/login?next=/upload", label: "Post the first clip" } : undefined}
      >
        When someone posts a clip it shows up here. Swipe up for the next one.
      </FeedNotice>
    );
  }
  return (
    <>
      {tabs}
      <Feed initial={state.clips} mediaBase={state.mediaBase} signedIn={state.signedIn} source={source} />
    </>
  );
}
