import { Suspense } from "react";
import { PreviewNote } from "@/components/admin/AdminShell";
import { SettingsPanel } from "@/components/admin/SettingsPanel";
import { previewSettings } from "@/lib/admin/preview";
import { adminGate, adminRead } from "@/lib/admin/server";
import { readSettingRows } from "@/lib/admin/types";

async function Settings() {
  const gate = await adminGate();
  if (gate.kind === "preview") {
    return (
      <>
        <PreviewNote />
        <SettingsPanel settings={previewSettings} preview />
      </>
    );
  }
  return <SettingsPanel settings={readSettingRows(await adminRead(gate.db, "admin_settings"))} preview={false} />;
}

/** /admin/settings: upload limits, who can upload, comments, sign-ups, the banner. */
export default function AdminSettingsPage() {
  return (
    <Suspense fallback={<div className="h-64 rounded-2xl bg-skeleton" aria-hidden />}>
      <Settings />
    </Suspense>
  );
}
