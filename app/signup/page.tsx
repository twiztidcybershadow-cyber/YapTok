import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthCard, DbNotConnected, FeatureOff, FormSkeleton, SignupsClosed } from "@/components/auth/AuthCard";
import { SignupForm } from "@/components/auth/SignupForm";
import { safeNext } from "@/lib/accounts/redirect";
import { accountsState } from "@/lib/accounts/server";
import { getSettings } from "@/lib/site/settings";

export const metadata = { title: "Create your account | YapTok" };

async function SignupGate({ searchParams }: { searchParams: PageProps<"/signup">["searchParams"] }) {
  const next = safeNext((await searchParams).next);
  const state = await accountsState();
  if (state.kind === "no-db") return <DbNotConnected />;
  if (state.kind === "off") return <FeatureOff />;
  if (state.user) redirect(state.user.onboarded ? next : "/welcome");
  // The database refuses too (handle_new_user in 003_profiles.sql); this is the friendly version.
  if (!(await getSettings()).signupsOpen) return <SignupsClosed />;
  return <SignupForm next={next} />;
}

export default function SignupPage({ searchParams }: PageProps<"/signup">) {
  return (
    <AuthCard title="Create your account" subtitle="to continue to YapTok">
      <Suspense fallback={<FormSkeleton />}>
        <SignupGate searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}
