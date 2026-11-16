"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Anything that throws while a page renders. */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div data-error-state="500" className="flex min-h-[calc(100dvh-var(--bottom-bar))] flex-col items-center justify-center px-6 text-center">
      <h1 className="text-[20px] font-medium text-text">Something went wrong.</h1>
      <p className="mt-2 text-[14px] text-text-2">Sorry about that. Try again in a moment.</p>
      <div className="mt-5 flex gap-2">
        <button type="button" onClick={() => retry()} className="btn-ghost">
          Try again
        </button>
        <Link href="/" className="btn-primary">
          Back home
        </Link>
      </div>
    </div>
  );
}
