import "server-only";
import { connection } from "next/server";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { getSettings } from "@/lib/site/settings";
import type { PublicSettings } from "@/lib/site/settings-core";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { readR2Config } from "./env";

export type UploadPageState =
  /** No Supabase settings: the form is shown as a preview with "database not connected". */
  | { kind: "no-db"; settings: PublicSettings }
  /** The flag is off for this person. */
  | { kind: "off" }
  | { kind: "signed-out" }
  | { kind: "not-onboarded" }
  /** configured: the R2 settings are there. recordOn: the record flag. */
  | { kind: "ready"; user: CurrentUser; configured: boolean; recordOn: boolean; settings: PublicSettings };

/** What /upload should show. Reads the request, so call it inside <Suspense>. */
export async function uploadPageState(): Promise<UploadPageState> {
  await connection();
  const settings = await getSettings();
  if (!readSupabaseConfig()) return { kind: "no-db", settings };
  const user = await getCurrentUser();
  if (!(await flagOn("upload", user?.id ?? null))) return { kind: "off" };
  if (!user) return { kind: "signed-out" };
  if (!user.onboarded) return { kind: "not-onboarded" };
  return {
    kind: "ready",
    user,
    configured: readR2Config() !== null,
    recordOn: await flagOn("record", user.id),
    settings,
  };
}
