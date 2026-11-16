import { Suspense } from "react";
import { AccountsTable } from "@/components/admin/AccountsTable";
import { ListFilter, PreviewNote } from "@/components/admin/AdminShell";
import { previewAccounts } from "@/lib/admin/preview";
import { adminGate, adminRead } from "@/lib/admin/server";
import { readAccounts } from "@/lib/admin/types";

const STATES: [string, string][] = [
  ["all", "All accounts"],
  ["banned", "Banned"],
  ["verified", "Verified"],
  ["invited", "Invited"],
];

async function Accounts({ searchParams }: { searchParams: PageProps<"/admin/accounts">["searchParams"] }) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 100) : "";
  const state = STATES.some(([s]) => s === params.state) ? String(params.state) : "all";
  const gate = await adminGate();
  const filter = <ListFilter q={q} state={state} states={STATES} placeholder="Username or name" />;
  if (gate.kind === "preview") {
    return (
      <>
        <PreviewNote />
        {filter}
        <AccountsTable accounts={previewAccounts} preview />
      </>
    );
  }
  return (
    <>
      {filter}
      <AccountsTable accounts={readAccounts(await adminRead(gate.db, "admin_accounts", { p_q: q, p_state: state }))} preview={false} />
    </>
  );
}

/** /admin/accounts: ban, unban, verify, invite. */
export default function AdminAccountsPage({ searchParams }: PageProps<"/admin/accounts">) {
  return (
    <Suspense fallback={<div className="h-64 rounded-2xl bg-skeleton" aria-hidden />}>
      <Accounts searchParams={searchParams} />
    </Suspense>
  );
}
