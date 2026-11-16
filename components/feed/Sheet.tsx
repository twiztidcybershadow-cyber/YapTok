"use client";

import { useEffect, type ReactNode } from "react";
import { CloseIcon } from "@/components/icons";

/**
 * A sheet that slides up over the bottom of a clip (comments, share,
 * report). Escape or the X closes it. Swipes and the wheel inside it scroll
 * the sheet, not the feed (data-no-swipe).
 */
export function Sheet({ title, onClose, children, tall }: { title: string; onClose: () => void; children: ReactNode; tall?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 z-20 cursor-default bg-black/40" />
      <section
        role="dialog"
        aria-label={title}
        data-no-swipe
        data-sheet
        className={`absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl bg-surface text-text ${tall ? "h-[70%]" : "max-h-[80%]"}`}
      >
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-divider pl-4 pr-1">
          <h2 className="text-[15px] font-medium">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full text-icon hover:bg-hover">
            <CloseIcon className="h-5 w-5" />
          </button>
        </header>
        {children}
      </section>
    </>
  );
}
