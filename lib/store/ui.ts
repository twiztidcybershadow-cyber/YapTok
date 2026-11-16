import { create } from "zustand";
import { readMutedPref } from "@/lib/feed/gestures";
import { applyTheme, readTheme, type Theme } from "@/lib/theme";

const SOUND_KEY = "yaptok-sound";

type UiState = {
  theme: Theme;
  /** The feed plays without sound until the person taps the sound button once. */
  muted: boolean;
  syncTheme: () => void;
  setTheme: (theme: Theme) => void;
  /** The person's choice: remembered on this device for the next visit. */
  setMuted: (muted: boolean) => void;
  /** Reads the remembered choice. Called once when the feed shows. */
  syncSound: () => void;
  /** The browser refused sound without a tap: mute for now, keep the remembered choice. */
  soundBlocked: () => void;
  /** A short message at the bottom of the screen, gone after a few seconds. */
  /** Unread things in the inbox, for the dot in the navigation. */
  unread: number;
  setUnread: (unread: number) => void;
  toast: string | null;
  showToast: (text: string | null) => void;
};

export const useUi = create<UiState>((set) => ({
  theme: "dark",
  muted: true,
  syncTheme: () => set({ theme: readTheme() }),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  setMuted: (muted) => {
    try {
      localStorage.setItem(SOUND_KEY, muted ? "off" : "on");
    } catch {
      // Storage blocked: the choice still holds for this page.
    }
    set({ muted });
  },
  syncSound: () => {
    try {
      set({ muted: readMutedPref(localStorage.getItem(SOUND_KEY)) });
    } catch {
      // Storage blocked: stay muted.
    }
  },
  soundBlocked: () => set({ muted: true }),
  unread: 0,
  setUnread: (unread) => set({ unread }),
  toast: null,
  showToast: (toast) => set({ toast }),
}));
