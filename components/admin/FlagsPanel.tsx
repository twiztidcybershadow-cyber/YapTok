"use client";

import { useState } from "react";
import { SearchIcon } from "@/components/icons";
import { MODE_LABELS, filterFlags, modeHint, type AdminFlag, type FlagMode } from "@/lib/admin/types";
import { timeAgo } from "@/lib/feed/format";
import { ChangedBy, Empty } from "./AdminShell";
import { useAdminAction } from "./useAdminAction";

const MODES: FlagMode[] = ["off", "test", "everyone"];

/**
 * Every feature flag with its three way switch: Off, Test (only the listed
 * testers, which includes the admin who pressed it) and Everyone. A press
 * changes the real row through set_feature_flag(), so it takes effect on the
 * next page load of every visitor, without a deploy.
 */
export function FlagsPanel({ flags, preview }: { flags: AdminFlag[]; preview: boolean }) {
  const [query, setQuery] = useState("");
  const { run, busy } = useAdminAction(preview);
  const shown = filterFlags(flags, query);

  return (
    <section aria-label="Feature flags">
      <div className="relative mb-4 max-w-[420px]">
        <SearchIcon className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-icon" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search features"
          aria-label="Search features"
          data-flag-search
          className="field !h-10 !pl-10 text-[14px]"
        />
      </div>
      {shown.length === 0 ? (
        <Empty>No feature matches &quot;{query}&quot;.</Empty>
      ) : (
        <ul className="card divide-y divide-divider" data-flag-list>
          {shown.map((flag) => (
            <li key={flag.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center" data-flag={flag.key} data-flag-mode={flag.mode}>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-[15px] font-medium text-text">
                  {flag.label}
                  <code className="text-[12px] font-normal text-text-3">{flag.key}</code>
                </p>
                <p className="mt-0.5 text-[13px] leading-[18px] text-text-2">{flag.description}</p>
                <p className="mt-1 flex flex-wrap gap-x-3 text-[12px] text-text-3">
                  <span>{modeHint(flag)}</span>
                  <ChangedBy who={flag.updatedBy} when={timeAgo(flag.updatedAt)} />
                </p>
              </div>
              <div role="radiogroup" aria-label={`${flag.label}: who sees it`} className="flex shrink-0 rounded-full border border-divider p-0.5">
                {MODES.map((mode) => {
                  const on = flag.mode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={busy === flag.key}
                      data-mode={mode}
                      onClick={() => {
                        if (!on || mode === "test") void run(flag.key, "set_feature_flag", { p_key: flag.key, p_mode: mode }, `${flag.label}: ${MODE_LABELS[mode].toLowerCase()}`);
                      }}
                      className={`h-8 min-w-[76px] rounded-full px-3 text-[13px] font-medium disabled:opacity-50 ${
                        on
                          ? mode === "off"
                            ? "bg-active text-text"
                            : mode === "test"
                              ? "bg-[color-mix(in_srgb,var(--warn)_22%,transparent)] text-warn"
                              : "bg-[var(--brand-strong)] text-white"
                          : "text-text-2 hover:bg-hover"
                      }`}
                    >
                      {MODE_LABELS[mode]}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
