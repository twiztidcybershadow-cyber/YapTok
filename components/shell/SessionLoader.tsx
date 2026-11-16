import { connection } from "next/server";
import { SessionProvider } from "@/components/SessionProvider";
import { getCurrentUser, toSessionUser } from "@/lib/auth";
import { mediaBase } from "@/lib/feed/server";
import { evaluateAllFlags } from "@/lib/flags";
import { getSettings } from "@/lib/site/settings";
import { readSupabaseConfig } from "@/lib/supabase/env";

/**
 * Reads the request once per page (session cookie, flags, site settings) and
 * hands the result to the browser store, where the navigation and every
 * client component pick it up. It sits behind a Suspense boundary and streams in.
 */
export async function SessionLoader() {
  await connection();
  const config = readSupabaseConfig();
  const user = await getCurrentUser();
  const [flags, settings] = await Promise.all([evaluateAllFlags(user?.id ?? null), getSettings()]);
  return (
    <SessionProvider
      config={config}
      user={user ? toSessionUser(user) : null}
      flags={flags}
      admin={user?.admin === true}
      settings={settings}
      mediaBase={mediaBase()}
    />
  );
}
