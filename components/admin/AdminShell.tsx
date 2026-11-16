"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const TABS = [
  { href: "/admin", label: "Features" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/videos", label: "Clips" },
  { href: "/admin/accounts", label: "Accounts" },
  { href: "/admin/log", label: "Log" },
  { href: "/admin/stats", label: "Stats" },
];

/** The frame of every admin page: the title and the row of tabs. */
export function AdminShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6" data-admin>
      <h1 className="text-[24px] font-medium leading-8 text-text">Admin</h1>
      <nav aria-label="Admin" className="-mx-4 mt-4 flex gap-1 overflow-x-auto border-b border-divider px-4 sm:mx-0 sm:px-0">
        {TABS.map((tab) => {
          const active = tab.href === "/admin" ? path === "/admin" : path.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              prefetch={false}
              aria-current={active ? "page" : undefined}
              className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-[14px] font-medium ${active ? "border-[var(--brand)] text-text" : "border-transparent text-text-2 hover:text-text"}`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <div className="pt-6">{children}</div>
    </div>
  );
}

/** Shown on top of an admin page while it runs on made up rows. */
export function PreviewNote() {
  return (
    <p role="status" className="mb-4 rounded-xl border border-divider bg-hover px-4 py-3 text-[14px] text-text" data-admin-preview>
      <span className="font-medium">database not connected.</span> These rows are made up so you can look around. Nothing can be changed until Supabase is connected.
    </p>
  );
}

/** "changed by @owner · 3h ago", or "not changed yet". */
export function ChangedBy({ who, when }: { who: { username: string } | null; when: string }) {
  if (!who) return <span className="text-[12px] text-text-3">not changed yet</span>;
  return (
    <span className="text-[12px] text-text-3">
      changed by @{who.username}
      {when && ` · ${when}`}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="card px-4 py-10 text-center text-[14px] text-text-2">{children}</p>;
}

/** The search box and the state picker above a list. A plain GET form: the server does the search. */
export function ListFilter({ q, state, states, placeholder }: { q: string; state: string; states: [string, string][]; placeholder: string }) {
  return (
    <form method="get" className="mb-4 flex flex-wrap gap-2" role="search">
      <input name="q" defaultValue={q} placeholder={placeholder} aria-label="Search" className="field !h-10 min-w-0 flex-1 text-[14px] sm:max-w-[360px]" />
      <select name="state" defaultValue={state} aria-label="Show" className="field !h-10 !w-auto text-[14px]">
        {states.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <button type="submit" className="btn-ghost">
        Search
      </button>
    </form>
  );
}
