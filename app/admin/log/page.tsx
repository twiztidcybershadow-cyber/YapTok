import { Suspense } from "react";
import { PreviewNote } from "@/components/admin/AdminShell";
import { LogList } from "@/components/admin/LogList";
import { previewLog } from "@/lib/admin/preview";
import { adminGate, adminRead } from "@/lib/admin/server";
import { readLog } from "@/lib/admin/types";

async function Log() {
  const gate = await adminGate();
  if (gate.kind === "preview") {
    return (
      <>
        <PreviewNote />
        <LogList entries={previewLog} />
      </>
    );
  }
  return <LogList entries={readLog(await adminRead(gate.db, "admin_log_page", { p_limit: 100 }))} />;
}

/** /admin/log: the audit log of every admin action. */
export default function AdminLogPage() {
  return (
    <Suspense fallback={<div className="h-64 rounded-2xl bg-skeleton" aria-hidden />}>
      <Log />
    </Suspense>
  );
}
