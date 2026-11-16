import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DbNotConnected } from "@/components/auth/AuthCard";
import { SearchView } from "@/components/discover/SearchView";
import { searchState } from "@/lib/discover/server";

export const metadata = { title: "Discover | YapTok" };

async function SearchGate({ searchParams }: { searchParams: PageProps<"/search">["searchParams"] }) {
  const state = await searchState((await searchParams).q);
  if (state.kind === "no-db") {
    return (
      <div className="mx-auto max-w-[480px] px-4 py-10">
        <DbNotConnected />
      </div>
    );
  }
  if (state.kind === "off") notFound();
  return <SearchView q={state.q} results={state.results} discover={state.discover} mediaBase={state.mediaBase} tagsOn={state.tagsOn} />;
}

/** Search, and what is popular before you type. */
export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <Suspense fallback={<div className="mx-auto mt-6 h-12 max-w-[928px] rounded-full bg-skeleton" aria-hidden />}>
      <SearchGate searchParams={searchParams} />
    </Suspense>
  );
}
