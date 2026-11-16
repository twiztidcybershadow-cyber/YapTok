"use client";

import { useState } from "react";

/**
 * A button that asks before it acts: the first press opens a small form (with
 * a reason box when `reason` is set), the second does it. For removing a clip
 * and banning an account.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  reason,
  danger = true,
  disabled,
  onConfirm,
  testId,
}: {
  label: string;
  confirmLabel: string;
  /** Placeholder of the reason box, or leave out for no reason. */
  reason?: string;
  danger?: boolean;
  disabled?: boolean;
  onConfirm: (reason: string) => void;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open) {
    return (
      <button type="button" disabled={disabled} onClick={() => setOpen(true)} className={`${danger ? "btn-danger" : "btn-ghost"} btn-sm`} data-action={testId}>
        {label}
      </button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setOpen(false);
        onConfirm(text.trim());
        setText("");
      }}
    >
      {reason && <input autoFocus aria-label="Reason" placeholder={reason} maxLength={200} value={text} onChange={(e) => setText(e.target.value)} className="field !h-8 !w-[200px] text-[13px]" />}
      <button type="submit" disabled={disabled} className={`${danger ? "btn-danger" : "btn-primary"} btn-sm`} data-action={testId ? `${testId}-confirm` : undefined}>
        {confirmLabel}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="btn-ghost btn-sm">
        Cancel
      </button>
    </form>
  );
}
