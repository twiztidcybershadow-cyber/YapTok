import { create } from "zustand";
import { clampIndex } from "@/lib/feed/nav";
import { mergeClips, type Clip } from "@/lib/feed/types";

type FeedState = {
  /**
   * Which feed on the page owns the store right now. The framework keeps the
   * page you came from alive and hidden, so two feeds can exist at once
   * (For You and Following): only the one on screen draws from the store.
   */
  owner: string | null;
  /** Feeds that have been on screen before. A parked one draws nothing until it is back. */
  parked: Record<string, true>;
  clips: Clip[];
  /** The clip on screen. */
  index: number;
  hasMore: boolean;
  loading: boolean;
  /** Which sheet is open over the current clip, if any. */
  sheet: "comments" | "share" | "report" | null;
  /** Starts a feed from the first page the server rendered. */
  start: (owner: string, clips: Clip[], hasMore: boolean) => void;
  /** That feed left the screen. */
  stop: (owner: string) => void;
  go: (index: number) => void;
  step: (by: -1 | 1) => void;
  addPage: (clips: Clip[], hasMore: boolean) => void;
  setLoading: (loading: boolean) => void;
  /** Changes one clip (a like, a new comment count). */
  patch: (id: string, change: Partial<Clip>) => void;
  /** A follow applies to every clip of that creator in the list. */
  setFollowing: (authorId: string, following: boolean) => void;
  remove: (id: string) => void;
  openSheet: (sheet: FeedState["sheet"]) => void;
};

export const useFeed = create<FeedState>((set) => ({
  owner: null,
  parked: {},
  clips: [],
  index: 0,
  hasMore: false,
  loading: false,
  sheet: null,
  start: (owner, clips, hasMore) => set({ owner, clips, hasMore, index: 0, loading: false, sheet: null }),
  stop: (owner) => set((s) => ({ owner: s.owner === owner ? null : s.owner, parked: { ...s.parked, [owner]: true }, sheet: null })),
  go: (index) => set((s) => ({ index: clampIndex(index, s.clips.length), sheet: null })),
  step: (by) => set((s) => ({ index: clampIndex(s.index + by, s.clips.length), sheet: null })),
  addPage: (more, hasMore) => set((s) => ({ clips: mergeClips(s.clips, more), hasMore, loading: false })),
  setLoading: (loading) => set({ loading }),
  patch: (id, change) => set((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, ...change } : c)) })),
  setFollowing: (authorId, following) =>
    set((s) => ({ clips: s.clips.map((c) => (c.author.id === authorId ? { ...c, following } : c)) })),
  remove: (id) =>
    set((s) => {
      const clips = s.clips.filter((c) => c.id !== id);
      return { clips, index: clampIndex(s.index, clips.length), sheet: null };
    }),
  openSheet: (sheet) => set({ sheet }),
}));
