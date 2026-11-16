import { Suspense } from "react";
import { PreviewNote } from "@/components/admin/AdminShell";
import { FlagsPanel } from "@/components/admin/FlagsPanel";
import { previewFlags } from "@/lib/admin/preview";
import { adminGate, adminRead } from "@/lib/admin/server";
import { readFlags } from "@/lib/admin/types";

async function Flags() {
  const gate = await adminGate();
  if (gate.kind === "preview") {
    return (
      <>
        <PreviewNote />
        <FlagsPanel flags={previewFlags} preview />
      </>
    );
  }
  return <FlagsPanel flags={readFlags(await adminRead(gate.db, "admin_flags"))} preview={false} />;
}

/** /admin: the feature toggles. */
export default function AdminFlagsPage() {
  return (
    <Suspense fallback={<div className="h-64 rounded-2xl bg-skeleton" aria-hidden />}>
      <Flags />
    </Suspense>
  );
}
