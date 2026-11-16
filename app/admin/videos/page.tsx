import { Suspense } from "react";
import { ListFilter, PreviewNote } from "@/components/admin/AdminShell";
import { VideosTable } from "@/components/admin/VideosTable";
import { previewVideos } from "@/lib/admin/preview";
import { adminGate, adminRead } from "@/lib/admin/server";
import { readVideos } from "@/lib/admin/types";

const STATES: [string, string][] = [
  ["all", "All clips"],
  ["live", "Live"],
  ["removed", "Removed"],
  ["processing", "Processing"],
  ["failed", "Failed"],
];

async function Videos({ searchParams }: { searchParams: PageProps<"/admin/videos">["searchParams"] }) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 100) : "";
  const state = STATES.some(([s]) => s === params.state) ? String(params.state) : "all";
  const gate = await adminGate();
  const filter = <ListFilter q={q} state={state} states={STATES} placeholder="Caption, #hashtag, @creator or clip id" />;
  if (gate.kind === "preview") {
    return (
      <>
        <PreviewNote />
        {filter}
        <VideosTable videos={previewVideos} preview />
      </>
    );
  }
  return (
    <>
      {filter}
      <VideosTable videos={readVideos(await adminRead(gate.db, "admin_videos", { p_q: q, p_state: state }))} preview={false} />
    </>
  );
}

/** /admin/videos: remove and restore clips. */
export default function AdminVideosPage({ searchParams }: PageProps<"/admin/videos">) {
  return (
    <Suspense fallback={<div className="h-64 rounded-2xl bg-skeleton" aria-hidden />}>
      <Videos searchParams={searchParams} />
    </Suspense>
  );
}
