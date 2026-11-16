import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DbNotConnected } from "@/components/auth/AuthCard";
import { ClipGrid } from "@/components/feed/ClipGrid";
import { tagState } from "@/lib/discover/server";
import { cleanTag } from "@/lib/discover/types";
import { compactCount } from "@/lib/feed/format";
import { siteConfig } from "@/site.config";

export async function generateMetadata({ params }: PageProps<"/tag/[tag]">): Promise<Metadata> {
  const tag = cleanTag((await params).tag);
  return { title: tag ? `#${tag} | ${siteConfig.siteName}` : siteConfig.siteName };
}

async function TagGate({ params }: { params: PageProps<"/tag/[tag]">["params"] }) {
  const state = await tagState((await params).tag);
  if (state.kind === "missing") notFound();
  if (state.kind === "no-db") {
    return (
      <div className="mx-auto max-w-[480px] px-4 py-10">
        <DbNotConnected />
      </div>
    );
  }
  if (state.kind === "off") notFound();
  const { page } = state;
  return (
    <div className="mx-auto max-w-[960px] px-4 py-6 sm:px-6" data-tag={page.tag}>
      <header className="flex items-center gap-4">
        <span className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-hover text-[36px] font-bold text-[var(--link)]">#</span>
        <div className="min-w-0">
          <h1 className="truncate text-[24px] font-bold leading-8 text-text">#{page.tag}</h1>
          <p className="text-[14px] text-text-2">
            {compactCount(page.clipCount)} clip{page.clipCount === 1 ? "" : "s"} · {compactCount(page.viewCount)} views
          </p>
        </div>
      </header>
      {page.clips.length === 0 ? (
        <p className="mt-16 text-center text-[14px] text-text-2" data-tag-empty>
          No clips with this hashtag yet. Post one and it shows up here.
        </p>
      ) : (
        <div className="mt-6">
          <ClipGrid clips={page.clips} mediaBase={state.mediaBase} />
        </div>
      )}
    </div>
  );
}

/** One hashtag: every clip that carries it, newest first. */
export default function TagPage({ params }: PageProps<"/tag/[tag]">) {
  return (
    <Suspense fallback={<div className="mx-auto mt-6 h-20 w-20 rounded-2xl bg-skeleton" aria-hidden />}>
      <TagGate params={params} />
    </Suspense>
  );
}
