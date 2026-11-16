"use client";

import { useEffect } from "react";
import { useSession, type SessionValues } from "@/lib/store/session";

/**
 * Hands what the server read for this request (database settings, the signed
 * in person, evaluated feature flags, site settings) to the browser store.
 */
export function SessionProvider(props: SessionValues) {
  const setSession = useSession((s) => s.setSession);
  const { config, user, flags, admin, settings, mediaBase } = props;
  useEffect(() => {
    setSession({ config, user, flags, admin, settings, mediaBase });
  }, [config, user, flags, admin, settings, mediaBase, setSession]);
  return null;
}
