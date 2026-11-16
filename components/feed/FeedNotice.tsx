import Link from "next/link";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/icons";

/**
 * What the feed's place shows when there is nothing to play: the database is
 * not connected, the feed is off (the mark alone, no words), or nobody has posted yet. The same
 * full stage as the feed, so the page never jumps.
 */
export function FeedNotice({ state, title, children, action }: { state: string; title?: string; children?: ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="feed-stage flex items-center justify-center !bg-page px-6" data-feed-empty={state}>
      <div className="max-w-[360px] text-center">
        <LogoMark className="mx-auto h-16 w-16 opacity-90" />
        {title && <h1 className="mt-5 text-[20px] font-medium leading-7 text-text">{title}</h1>}
        {children && <div className="mt-2 text-[14px] leading-5 text-text-2">{children}</div>}
        {action && (
          <Link href={action.href} prefetch={false} className="btn-primary mt-5">
            {action.label}
          </Link>
        )}
      </div>
    </div>
  );
}

/** The grey stage shown while the first page of the feed loads. */
export function FeedSkeleton() {
  return (
    <div className="feed-stage flex items-center justify-center" aria-hidden>
      <div className="h-full w-full bg-[#1a1614] desk:my-4 desk:aspect-[9/16] desk:h-[calc(100%-32px)] desk:w-auto desk:rounded-2xl" />
    </div>
  );
}
