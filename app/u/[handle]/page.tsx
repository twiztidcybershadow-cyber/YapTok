import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DbNotConnected } from "@/components/auth/AuthCard";
import { ProfileView } from "@/components/profile/ProfileView";
import { profileState } from "@/lib/feed/server";
import { siteConfig } from "@/site.config";

export async function generateMetadata({ params }: PageProps<"/u/[handle]">): Promise<Metadata> {
  const state = await profileState((await params).handle);
  if (state.kind !== "found") return { title: siteConfig.siteName };
  return {
    title: `${state.profile.displayName} (@${state.profile.username}) | ${siteConfig.siteName}`,
    description: state.profile.bio || `Clips by @${state.profile.username} on ${siteConfig.siteName}.`,
  };
}

async function ProfileGate({ params, searchParams }: Pick<PageProps<"/u/[handle]">, "params" | "searchParams">) {
  const wanted = (await searchParams).tab;
  const state = await profileState((await params).handle, wanted === "liked" || wanted === "saved" ? wanted : "clips");
  if (state.kind === "missing") notFound();
  if (state.kind === "no-db") {
    return (
      <div className="mx-auto max-w-[480px] px-4 py-10">
        <DbNotConnected />
      </div>
    );
  }
  if (state.kind === "off") notFound();
  return (
    <ProfileView
      profile={state.profile}
      clips={state.clips}
      following={state.following}
      mine={state.mine}
      mediaBase={state.mediaBase}
      signedIn={state.signedIn}
      tab={state.tab}
      tabsOn={state.tabsOn}
    />
  );
}

/** A creator's page, at /@username (see the rewrite in next.config.ts). */
export default function ProfilePage({ params, searchParams }: PageProps<"/u/[handle]">) {
  return (
    <Suspense fallback={<div className="mx-auto mt-10 h-24 w-24 rounded-full bg-skeleton" aria-hidden />}>
      <ProfileGate params={params} searchParams={searchParams} />
    </Suspense>
  );
}
