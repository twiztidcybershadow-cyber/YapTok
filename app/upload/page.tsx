import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { Uploader } from "@/components/upload/Uploader";
import { uploadWhoText } from "@/lib/site/settings-core";
import { uploadPageState } from "@/lib/upload/server";

export const metadata = { title: "Upload | YapTok" };

async function UploadGate() {
  const state = await uploadPageState();
  if (state.kind === "no-db") {
    return <Uploader settings={state.settings} recordOn={false} blocked="database not connected. This is a preview of the upload form: posting needs Supabase and storage." />;
  }
  if (state.kind === "off") {
    notFound();
  }
  if (state.kind === "signed-out") redirect("/login?next=/upload");
  if (state.kind === "not-onboarded") redirect("/welcome?next=/upload");
  const { settings, user } = state;
  const shutOut =
    (settings.uploadWho === "verified" && !user.verified) || settings.uploadWho === "invite"
      ? `Uploading is limited right now: ${uploadWhoText(settings.uploadWho).toLowerCase()}.`
      : null;
  return (
    <>
      {shutOut && settings.uploadWho === "verified" && (
        <p role="status" className="mb-4 rounded-xl border border-divider bg-hover px-4 py-3 text-[14px] text-text">
          {shutOut} You can still try the form; ask the owner to verify your account.
        </p>
      )}
      <Uploader
        settings={settings}
        recordOn={state.recordOn}
        blocked={state.configured ? null : "Storage is not set up on this server yet, so posting is off. Add the R2 settings (see .env.example) and restart."}
      />
    </>
  );
}

/** Pick or record a clip, caption, hashtags, cover frame, post. */
export default function UploadPage() {
  return (
    <div className="mx-auto max-w-[900px] px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-[24px] font-medium leading-8 text-text">Upload</h1>
        <Link href="/" className="text-[14px] text-text-2 hover:underline">
          Back to the feed
        </Link>
      </div>
      <Suspense fallback={<div className="mx-auto h-64 max-w-[560px] rounded-2xl bg-skeleton" aria-hidden />}>
        <UploadGate />
      </Suspense>
    </div>
  );
}
