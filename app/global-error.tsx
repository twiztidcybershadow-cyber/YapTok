"use client";

import "./globals.css";
import { themeScript } from "@/lib/theme";

/** When the root layout itself fails: its own document, in the theme the visitor picked. */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <title>Something went wrong | YapTok</title>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full font-sans">
        <main data-error-state="500" className="flex min-h-screen flex-col items-center justify-center bg-page px-6 text-center">
          <h1 className="text-[20px] font-medium text-text">Something went wrong.</h1>
          <p className="mt-2 text-[14px] text-text-2">Sorry about that. Try again in a moment.</p>
          <div className="mt-5 flex gap-2">
            <button type="button" onClick={() => retry()} className="btn-ghost">
              Try again
            </button>
            {/* A full page load on purpose: the root layout is what failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="btn-primary">
              Back home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
