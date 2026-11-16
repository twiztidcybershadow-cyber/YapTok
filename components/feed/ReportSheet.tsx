"use client";

import { useState, type FormEvent } from "react";
import { socialErrorText } from "@/lib/feed/format";
import { callRpc } from "@/lib/social/client";
import { REPORT_NOTE_MAX, REPORT_REASONS, type ReportReason } from "@/lib/social/reports";
import { useUi } from "@/lib/store/ui";
import { Sheet } from "./Sheet";

/** Report a clip or a comment: pick a reason, add a note if you want. It lands in /admin/reports. */
export function ReportSheet({ target, onClose }: { target: { type: "video" | "comment"; id: string }; onClose: () => void }) {
  const showToast = useUi((s) => s.showToast);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!reason || busy) return;
    setBusy(true);
    setError(null);
    const res = await callRpc<string>("report_content", { p_type: target.type, p_id: target.id, p_reason: reason, p_note: note });
    setBusy(false);
    if (!res.ok) return setError(socialErrorText(res.code));
    showToast(res.data === "already" ? "You already reported this. We are on it." : "Thanks. A moderator will take a look.");
    onClose();
  }

  return (
    <Sheet title={target.type === "video" ? "Report this clip" : "Report this comment"} onClose={onClose}>
      <form onSubmit={send} className="min-h-0 overflow-y-auto overscroll-contain p-4 pb-[max(16px,env(safe-area-inset-bottom))]" data-report-form>
        <fieldset className="space-y-1">
          <legend className="mb-2 text-[13px] text-text-2">What is wrong with it?</legend>
          {REPORT_REASONS.map((r) => (
            <label key={r.key} className="flex h-10 cursor-pointer items-center gap-3 rounded-lg px-2 text-[14px] hover:bg-hover">
              <input type="radio" name="reason" value={r.key} checked={reason === r.key} onChange={() => setReason(r.key)} className="h-4 w-4 accent-[var(--brand)]" />
              {r.label}
            </label>
          ))}
        </fieldset>
        <textarea
          aria-label="Anything to add? (optional)"
          placeholder="Anything to add? (optional)"
          className="field mt-3 min-h-[72px] text-[14px]"
          maxLength={REPORT_NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {error && (
          <p role="alert" className="mt-2 text-[13px] text-error">
            {error}
          </p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={!reason || busy} className="btn-primary">
            {busy ? "Sending" : "Send report"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
