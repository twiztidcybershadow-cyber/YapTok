"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { adminErrorText } from "@/lib/admin/types";
import { callRpc } from "@/lib/social/client";
import { useUi } from "@/lib/store/ui";

/**
 * Runs one admin function, says what happened in a toast and reloads the
 * page's data. `busy` is the key of the action that is running, so a row can
 * grey out its own buttons. In the preview (no database) nothing is called.
 */
export function useAdminAction(preview: boolean) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async (key: string, fn: string, args: Record<string, unknown>, done: string): Promise<boolean> => {
      const { showToast } = useUi.getState();
      if (preview) {
        showToast("This is a preview: connect the database to change things.");
        return false;
      }
      setBusy(key);
      const res = await callRpc(fn, args);
      setBusy(null);
      if (!res.ok) {
        showToast(adminErrorText(res.code));
        return false;
      }
      showToast(done);
      router.refresh();
      return true;
    },
    [preview, router],
  );
  return { run, busy };
}
