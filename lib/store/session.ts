import { create } from "zustand";
import type { PublicSettings } from "@/lib/site/settings-core";
import { DEFAULT_SETTINGS } from "@/lib/site/settings-core";
import type { SupabaseConfig } from "@/lib/supabase/env";

/** What the browser knows about the signed in person. Never secrets. */
export type SessionUser = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  /** False until username and birthdate are confirmed (complete_signup). */
  onboarded: boolean;
};

export type SessionValues = {
  config: SupabaseConfig | null;
  user: SessionUser | null;
  /** Feature flags already evaluated for this person: key to on or off. */
  flags: Record<string, boolean>;
  /** In the admins table. Only decides what the UI shows: the database checks every action. */
  admin: boolean;
  /** The site settings from /admin/settings that the pages need. */
  settings: PublicSettings;
  /** Where the clips are served from when the bucket has a public address, else null. */
  mediaBase: string | null;
};

type SessionState = SessionValues & {
  /** True once the server has handed its values over for this page load. */
  loaded: boolean;
  setSession: (s: SessionValues) => void;
};

export const useSession = create<SessionState>((set) => ({
  loaded: false,
  config: null,
  user: null,
  flags: {},
  admin: false,
  settings: DEFAULT_SETTINGS,
  mediaBase: null,
  setSession: (s) => set({ ...s, loaded: true }),
}));

/** Client side flag check. Use flagOn() from lib/flags.ts on the server. */
export function useFlag(key: string): boolean {
  return useSession((s) => s.flags[key] === true);
}
