"use client";

import { useState, type FormEvent } from "react";
import type { AdminSetting } from "@/lib/admin/types";
import { timeAgo } from "@/lib/feed/format";
import { uploadWhoText, type UploadWho } from "@/lib/site/settings-core";
import { ChangedBy } from "./AdminShell";
import { useAdminAction } from "./useAdminAction";

const UNITS: Record<string, string> = { upload_max_seconds: "seconds", upload_max_mb: "MB", upload_daily_limit: "a day" };

function choiceLabel(key: string, option: string): string {
  return key === "upload_who" ? uploadWhoText(option as UploadWho) : option;
}

function switchLabels(key: string): [string, string] {
  return key === "signups_open" ? ["Open", "Closed"] : ["On", "Off"];
}

function Row({ setting, preview }: { setting: AdminSetting; preview: boolean }) {
  const { run, busy } = useAdminAction(preview);
  const [draft, setDraft] = useState(String(setting.value));
  const saving = busy === setting.key;
  const save = (value: unknown) => run(setting.key, "set_site_setting", { p_key: setting.key, p_value: value }, `${setting.label} saved`);

  let control;
  if (setting.kind === "boolean") {
    const [yes, no] = switchLabels(setting.key);
    control = (
      <button
        type="button"
        role="switch"
        aria-checked={setting.value === true}
        aria-label={setting.label}
        disabled={saving}
        onClick={() => void save(setting.value !== true)}
        className="flex items-center gap-3 disabled:opacity-50"
      >
        <span className={`relative h-7 w-12 rounded-full transition-colors ${setting.value === true ? "bg-[var(--brand-strong)]" : "bg-active"}`}>
          <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-[left] ${setting.value === true ? "left-[22px]" : "left-0.5"}`} />
        </span>
        <span className="w-14 text-left text-[14px] font-medium text-text">{setting.value === true ? yes : no}</span>
      </button>
    );
  } else if (setting.kind === "choice") {
    control = (
      <div role="radiogroup" aria-label={setting.label} className="flex flex-wrap gap-2">
        {setting.options.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={setting.value === option}
            disabled={saving}
            onClick={() => setting.value !== option && void save(option)}
            className={`h-9 rounded-full border px-4 text-[13px] font-medium disabled:opacity-50 ${
              setting.value === option ? "border-[var(--brand)] bg-[var(--brand-strong)] text-white" : "border-divider text-text-2 hover:bg-hover"
            }`}
          >
            {choiceLabel(setting.key, option)}
          </button>
        ))}
      </div>
    );
  } else {
    const number = setting.kind === "number";
    const submit = (e: FormEvent) => {
      e.preventDefault();
      void save(number ? Number(draft) : draft.trim());
    };
    const unchanged = draft.trim() === String(setting.value);
    const bad = number && (!/^\d+$/.test(draft.trim()) || Number(draft) < (setting.min ?? 0) || Number(draft) > (setting.max ?? Infinity));
    control = (
      <form onSubmit={submit} className="flex w-full items-center gap-2 sm:w-auto">
        <input
          aria-label={setting.label}
          inputMode={number ? "numeric" : undefined}
          maxLength={number ? 6 : (setting.max ?? 200)}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={number ? undefined : "No banner"}
          className={`field !h-10 text-[14px] ${number ? "!w-24 text-right" : "min-w-0 flex-1 sm:!w-[320px]"}`}
        />
        {number && <span className="w-16 text-[13px] text-text-2">{UNITS[setting.key] ?? ""}</span>}
        <button type="submit" disabled={saving || unchanged || bad} className="btn-primary btn-sm">
          Save
        </button>
      </form>
    );
  }

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between" data-setting={setting.key}>
      <div className="min-w-0 sm:max-w-[48%]">
        <p className="text-[15px] font-medium text-text">{setting.label}</p>
        <p className="mt-0.5 text-[13px] leading-[18px] text-text-2">
          {setting.description}
          {setting.kind === "number" && setting.min !== null && setting.max !== null && ` Between ${setting.min} and ${setting.max}.`}
        </p>
        <p className="mt-1">
          <ChangedBy who={setting.updatedBy} when={timeAgo(setting.updatedAt)} />
        </p>
      </div>
      <div className="shrink-0">{control}</div>
    </li>
  );
}

/**
 * The site settings the owner changes without code. Each one saves on its own
 * through set_site_setting(), which checks the value and writes the audit
 * log. The database reads the same rows when it checks an upload, a comment
 * or a sign-up, so a change counts from the next request.
 */
export function SettingsPanel({ settings, preview }: { settings: AdminSetting[]; preview: boolean }) {
  return (
    <ul className="card divide-y divide-divider" aria-label="Site settings">
      {settings.map((s) => (
        // The key resets the draft when the saved value changes.
        <Row key={`${s.key}:${String(s.value)}`} setting={s} preview={preview} />
      ))}
    </ul>
  );
}
