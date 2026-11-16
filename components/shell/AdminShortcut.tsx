"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFlag, useSession } from "@/lib/store/session";

/**
 * Ctrl+Shift+S (Cmd+Shift+S on a Mac) opens the admin panel, for admins only.
 * For everyone else the keys do nothing: /admin stays a plain 404 for them.
 */
export function AdminShortcut() {
  const router = useRouter();
  const admin = useSession((s) => s.admin);
  const flagOn = useFlag("admin");
  const enabled = admin && flagOn;

  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      router.push("/admin");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, router]);

  return null;
}
