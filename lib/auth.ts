import "server-only";
import { cache } from "react";
import type { SessionUser } from "@/lib/store/session";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = SessionUser & {
  email: string | null;
  bio: string;
  verified: boolean;
  /** In the admins table (is_admin() in 002_admin.sql). */
  admin: boolean;
};

/** Public profile columns. birthdate and the ban columns are never readable through the API. */
export const PROFILE_COLUMNS = "username, display_name, avatar_url, bio, onboarded, verified";

/**
 * The signed in person and their profile, read once per request.
 * Returns null when signed out or when the database is not connected.
 * Only call it inside a <Suspense> boundary: it reads the session cookie.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  if (!supabase) return null;

  // getClaims verifies the access token (locally when the project uses
  // asymmetric signing keys) instead of trusting the cookie as is.
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  const id = data.claims.sub;
  const email = typeof data.claims.email === "string" ? data.claims.email : null;

  const [{ data: profile }, { data: admin }] = await Promise.all([
    supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", id).maybeSingle(),
    // Fails quietly (null) until migration 002 is applied.
    supabase.rpc("is_admin"),
  ]);

  const fallbackName = email?.split("@")[0] ?? "you";
  return {
    id,
    email,
    username: profile?.username ?? fallbackName,
    displayName: profile?.display_name || profile?.username || fallbackName,
    avatarUrl: profile?.avatar_url ?? null,
    bio: profile?.bio ?? "",
    onboarded: profile?.onboarded ?? false,
    verified: profile?.verified ?? false,
    admin: admin === true,
  };
});

/** Strip a CurrentUser down to what the browser store may hold. */
export function toSessionUser(user: CurrentUser): SessionUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    onboarded: user.onboarded,
  };
}
