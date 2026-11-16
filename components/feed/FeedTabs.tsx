import Link from "next/link";

/** The switch on top of the feed: For You or Following. Only shown while the following flag is on. */
export function FeedTabs({ current }: { current: "foryou" | "following" }) {
  const tab = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      prefetch={false}
      aria-current={on ? "page" : undefined}
      className={`over-video relative px-3 py-2 text-[16px] font-bold ${on ? "text-white" : "text-white/60 hover:text-white/85"}`}
    >
      {label}
      {on && <span aria-hidden className="absolute inset-x-3 -bottom-0.5 h-[3px] rounded-full bg-white" />}
    </Link>
  );
  return (
    <nav
      aria-label="Feed"
      data-feed-tabs
      // Fixed over the stage, below the banner line if there is one, clear of the notch.
      className="pointer-events-none fixed inset-x-0 top-[calc(var(--banner,0px)+env(safe-area-inset-top,0px)+8px)] z-30 flex justify-center desk:left-[220px]"
    >
      <div className="pointer-events-auto flex gap-1 rounded-full bg-black/25 px-2 backdrop-blur-sm">
        {tab("/following", "Following", current === "following")}
        {tab("/", "For You", current === "foryou")}
      </div>
    </nav>
  );
}
