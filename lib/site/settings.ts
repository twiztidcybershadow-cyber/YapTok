import "server-only";
import { cache } from "react";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { DEFAULT_SETTINGS, readSettings, type PublicSettings } from "./settings-core";

/**
 * The site settings, read once per request. They are public rows, so this
 * uses a plain client without the session cookie. Never cached across
 * requests: a change in /admin/settings shows on the next page load.
 */
export const getSettings = cache(async (): Promise<PublicSettings> => {
  const config = readSupabaseConfig();
  if (!config) return DEFAULT_SETTINGS;
  const supabase = createSupabaseClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.from("site_settings").select("key, value");
  if (error || !data) return DEFAULT_SETTINGS;
  return readSettings(data);
});
