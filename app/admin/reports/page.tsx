import { Suspense } from "react";
import { PreviewNote } from "@/components/admin/AdminShell";
import { ReportsQueue } from "@/components/admin/ReportsQueue";
import { previewReports } from "@/lib/admin/preview";
import { adminGate, adminRead } from "@/lib/admin/server";
import { readReports } from "@/lib/admin/types";

async function Reports({ searchParams }: { searchParams: PageProps<"/admin/reports">["searchParams"] }) {
  const status = (await searchParams).status === "closed" ? "closed" : "open";
  const gate = await adminGate();
  if (gate.kind === "preview") {
    return (
      <>
        <PreviewNote />
        <ReportsQueue reports={status === "open" ? previewReports : []} status={status} preview />
      </>
    );
  }
  return <ReportsQueue reports={readReports(await adminRead(gate.db, "admin_reports", { p_status: status }))} status={status} preview={false} />;
}

/** /admin/reports: reported clips and comments. */
export default function AdminReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  return (
    <Suspense fallback={<div className="h-64 rounded-2xl bg-skeleton" aria-hidden />}>
      <Reports searchParams={searchParams} />
    </Suspense>
  );
}
