import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DbNotConnected, FeatureOff, FormSkeleton } from "@/components/auth/AuthCard";
import { SettingsForm, type SettingsProfile } from "@/components/settings/SettingsForm";
import { accountsState } from "@/lib/accounts/server";

export const metadata = { title: "Settings | YapTok" };

const preview: SettingsProfile = {
  id: "preview",
  email: null,
  username: "your_username",
  displayName: "Your name",
  avatarUrl: null,
  bio: "",
};

async function SettingsGate() {
  const state = await accountsState();
  if (state.kind === "off") return <FeatureOff />;
  if (state.kind === "no-db") {
    return (
      <>
        <DbNotConnected />
        <SettingsForm profile={preview} disabled />
      </>
    );
  }
  const user = state.user;
  if (!user) redirect("/login?next=/settings");
  return (
    <>
      {user.email && (
        <p className="text-[14px] text-text-2">
          Signed in as <span className="text-text">{user.email}</span>
        </p>
      )}
      <SettingsForm
        profile={{
          id: user.id,
          email: user.email,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          bio: user.bio,
        }}
      />
    </>
  );
}

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-[900px] px-4 py-6 sm:px-6">
      <div className="card px-4 py-6 sm:px-8">
        <h1 className="text-[24px] font-medium leading-8 text-text">Settings</h1>
        <p className="mb-4 mt-1 text-[14px] text-text-2">Choose how you appear on YapTok.</p>
        <Suspense fallback={<FormSkeleton />}>
          <SettingsGate />
        </Suspense>
      </div>
    </div>
  );
}
