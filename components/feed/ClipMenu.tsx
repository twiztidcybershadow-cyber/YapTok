"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { FlagIcon, ShieldIcon, TrashIcon } from "@/components/icons";
import { socialErrorText } from "@/lib/feed/format";
import type { Clip } from "@/lib/feed/types";
import { callRpc, loginUrl } from "@/lib/social/client";
import { useFeed } from "@/lib/store/feed";
import { useFlag, useSession } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";

/** The "more" button on a clip: report it, delete it if it is yours, open it in the admin panel if you are an admin. */
export function ClipMenu({ clip, signedIn, children }: { clip: Clip; signedIn: boolean; children: ReactNode }) {
  const router = useRouter();
  const reports = useFlag("reports");
  const admin = useSession((s) => s.admin);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const canReport = reports && !clip.mine;
  if (!canReport && !clip.mine && !admin) return null;

  async function remove() {
    const res = await callRpc("delete_video", { video_id: clip.id });
    if (!res.ok) return useUi.getState().showToast(socialErrorText(res.code));
    useFeed.getState().remove(clip.id);
    useUi.getState().showToast("Clip deleted");
    router.refresh();
  }

  const row = "flex h-11 w-full items-center gap-3 px-4 text-left text-[14px] text-text hover:bg-hover";
  return (
    <div ref={ref} className="relative" data-no-swipe>
      <button
        type="button"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        data-rail="more"
        onClick={() => {
          setOpen(!open);
          setConfirming(false);
        }}
        className="grid h-12 w-12 place-items-center rounded-full bg-black/35 backdrop-blur-sm desk:bg-white/10 desk:hover:bg-white/20"
      >
        {children}
      </button>
      {open && (
        <div role="menu" style={{ boxShadow: "var(--menu-shadow)" }} className="absolute bottom-14 right-0 z-40 w-[220px] overflow-hidden rounded-xl bg-surface py-1">
          {canReport && (
            <button
              role="menuitem"
              type="button"
              className={row}
              onClick={() => {
                setOpen(false);
                if (!signedIn) return router.push(loginUrl(`/v/${clip.id}`));
                useFeed.getState().openSheet("report");
              }}
            >
              <FlagIcon className="h-5 w-5 text-icon" />
              Report
            </button>
          )}
          {clip.mine &&
            (confirming ? (
              <button role="menuitem" type="button" className={`${row} !text-error`} onClick={() => void remove()} data-confirm-delete>
                <TrashIcon className="h-5 w-5" />
                Tap again to delete for good
              </button>
            ) : (
              <button role="menuitem" type="button" className={row} onClick={() => setConfirming(true)}>
                <TrashIcon className="h-5 w-5 text-icon" />
                Delete clip
              </button>
            ))}
          {admin && (
            <a role="menuitem" href={`/admin/videos?q=${clip.id}`} className={row}>
              <ShieldIcon className="h-5 w-5 text-icon" />
              Open in admin
            </a>
          )}
        </div>
      )}
    </div>
  );
}
