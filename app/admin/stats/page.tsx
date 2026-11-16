import { Suspense } from "react";
import { PreviewNote } from "@/components/admin/AdminShell";
import { StatsView } from "@/components/admin/StatsView";
import { previewStats } from "@/lib/admin/preview";
import { adminGate, adminRead } from "@/lib/admin/server";
import { readStats } from "@/lib/admin/types";

async function Stats({ searchParams }: { searchParams: PageProps<"/admin/stats">["searchParams"] }) {
  const wanted = Number((await searchParams).days);
  const days = [7, 14, 30].includes(wanted) ? wanted : 14;
  const gate = await adminGate();
  if (gate.kind === "preview") {
    return (
      <>
        <PreviewNote />
        <StatsView stats={previewStats} days={14} />
      </>
    );
  }
  return <StatsView stats={readStats(await adminRead(gate.db, "admin_stats", { p_days: days }))} days={days} />;
}

/** /admin/stats: sign-ups, uploads and views per day. */
export default function AdminStatsPage({ searchParams }: PageProps<"/admin/stats">) {
  return (
    <Suspense fallback={<div className="h-64 rounded-2xl bg-skeleton" aria-hidden />}>
      <Stats searchParams={searchParams} />
    </Suspense>
  );
}
