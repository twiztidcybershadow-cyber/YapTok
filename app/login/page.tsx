import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthCard, DbNotConnected, FeatureOff, FormSkeleton } from "@/components/auth/AuthCard";
import { LoginForm } from "@/components/auth/LoginForm";
import { safeNext } from "@/lib/accounts/redirect";
import { accountsState } from "@/lib/accounts/server";

export const metadata = { title: "Sign in | YapTok" };

const callbackError = "Sign in did not finish. Try again.";
/** proxy.ts sends a banned account here once it has signed it out. */
const bannedError = "This account has been banned for breaking the rules.";

async function LoginGate({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const state = await accountsState();
  if (state.kind === "no-db") return <DbNotConnected />;
  if (state.kind === "off") return <FeatureOff />;
  if (state.user) redirect(state.user.onboarded ? next : "/welcome");
  return <LoginForm next={next} initialError={params.banned ? bannedError : params.error ? callbackError : null} />;
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <AuthCard title="Sign in" subtitle="to continue to YapTok">
      <Suspense fallback={<FormSkeleton />}>
        <LoginGate searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}
