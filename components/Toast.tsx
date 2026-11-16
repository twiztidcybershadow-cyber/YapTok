"use client";

import { useEffect } from "react";
import { useUi } from "@/lib/store/ui";

/** The one line message at the bottom of the screen ("Link copied"). */
export function Toast() {
  const toast = useUi((s) => s.toast);
  const showToast = useUi((s) => s.showToast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => showToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast, showToast]);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--bottom-bar)+16px)] z-[70] flex justify-center px-4">
      {toast && (
        <p className="rounded-full bg-[#2e2723] px-4 py-2 text-[14px] text-white shadow-lg" data-toast>
          {toast}
        </p>
      )}
    </div>
  );
}
