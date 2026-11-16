export const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
export const SUPABASE_KEY_ENV = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";

export type SupabaseConfig = { url: string; key: string };

/**
 * One setting, read from the environment when the request comes in.
 * Reflect.get on purpose: the bundler replaces every plain read of a
 * NEXT_PUBLIC setting (also through a constant name) by the value it sees while building,
 * which would freeze whatever was in .env.local at build time into the image.
 * It cannot see through this, so the same build runs with whatever is in
 * /opt/yaptok/.env. tests/open-source.test.mjs keeps it that way.
 */
function runtimeEnv(name: string): string | undefined {
  const value: unknown = Reflect.get(process.env, name);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Reads the Supabase settings on the server at request time. Null when
 * either is missing: the site then runs in "database not connected" mode.
 */
export function readSupabaseConfig(): SupabaseConfig | null {
  const url = runtimeEnv(SUPABASE_URL_ENV);
  const key = runtimeEnv(SUPABASE_KEY_ENV);
  if (!url || !key) return null;
  return { url, key };
}
