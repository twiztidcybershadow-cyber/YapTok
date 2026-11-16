"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "@/components/icons";
import {
  FEED_PAGE,
  VIEW_AFTER_MS,
  dragOffset,
  keyAction,
  shouldLoadMore,
  slotMode,
  swipeStep,
  wheelStep,
} from "@/lib/feed/nav";
import { feedCursor, readClips, type Clip } from "@/lib/feed/types";
import { viewerKey } from "@/lib/feed/viewer-key";
import { callRpc } from "@/lib/social/client";
import { useFeed } from "@/lib/store/feed";
import { useUi } from "@/lib/store/ui";
import type { ClipPlayerHandle } from "./ClipPlayer";
import { ClipSlide } from "./ClipSlide";
import { useLike } from "./useSocial";

/**
 * The For You feed: one clip fills the stage, the next one is already
 * buffering underneath. Swipe up or down on a phone, use the wheel, the arrow
 * keys (or j and k), or the two buttons on a desk. See lib/feed/nav.ts for
 * every rule; this component only connects them to the page.
 */
export function Feed({
  initial,
  mediaBase,
  signedIn,
  source = "feed_page",
}: {
  initial: Clip[];
  mediaBase: string | null;
  signedIn: boolean;
  /** The database function the next pages come from. */
  source?: "feed_page" | "following_page";
}) {
  const clips = useFeed((s) => s.clips);
  const index = useFeed((s) => s.index);
  const hasMore = useFeed((s) => s.hasMore);
  const loading = useFeed((s) => s.loading);
  const sheet = useFeed((s) => s.sheet);
  const start = useFeed((s) => s.start);
  const step = useFeed((s) => s.step);
  const muted = useUi((s) => s.muted);
  const setMuted = useUi((s) => s.setMuted);
  const stageRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<ClipPlayerHandle>(null);
  const lastWheel = useRef(0);
  const touch = useRef<{ y: number; at: number } | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const toggleLike = useLike(signedIn);

  // The server rendered the first page: hand it to the store once per page
  // load. Until then draw straight from it, so the first paint is the feed.
  const me = useId();
  const ready = useFeed((s) => s.owner === me);
  const parked = useFeed((s) => s.owner !== me && s.parked[me] === true);
  useEffect(() => {
    start(me, initial, initial.length >= FEED_PAGE);
    useUi.getState().syncSound();
    return () => useFeed.getState().stop(me);
    // Only on mount: a re-render must not restart the feed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Hidden behind another page: draw nothing, so no second set of players exists.
  const list = ready ? clips : parked ? [] : initial;
  const at = ready ? index : 0;
  const current = list[at];

  // Keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const action = keyAction({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        targetTag: target?.tagName,
        targetEditable: target?.isContentEditable,
      });
      if (!action) return;
      const state = useFeed.getState();
      const clip = state.clips[state.index];
      if (action.type === "step") {
        if (state.sheet) return;
        e.preventDefault();
        state.step(action.step);
      } else if (action.type === "toggle-play") {
        e.preventDefault();
        playerRef.current?.togglePlay();
      } else if (action.type === "toggle-mute") {
        useUi.getState().setMuted(!useUi.getState().muted);
      } else if (action.type === "like" && clip) {
        toggleLike(clip);
      } else if (action.type === "comments" && clip) {
        state.openSheet(state.sheet === "comments" ? null : "comments");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleLike]);

  // A view counts once the clip has been on screen for a moment.
  useEffect(() => {
    if (!current || current.status !== "ready") return;
    const id = current.id;
    const t = setTimeout(() => {
      void callRpc("record_view", { p_video: id, p_viewer_key: signedIn ? null : viewerKey() });
    }, VIEW_AFTER_MS);
    return () => clearTimeout(t);
  }, [current?.id, current?.status, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // The next page, a few clips before the end.
  useEffect(() => {
    if (!ready || !shouldLoadMore(index, clips.length, hasMore, loading)) return;
    const cursor = feedCursor(clips);
    if (!cursor) return;
    useFeed.getState().setLoading(true);
    void callRpc(source, { p_limit: FEED_PAGE, p_before: cursor.before, p_before_id: cursor.beforeId }).then((res) => {
      const more = res.ok ? readClips(res.data) : [];
      useFeed.getState().addPage(more, more.length >= FEED_PAGE);
    });
  }, [ready, index, clips, hasMore, loading, source]);

  const blocked = sheet !== null;

  return (
    <div
      ref={stageRef}
      className="feed-stage"
      data-feed
      data-feed-index={at}
      onWheel={(e) => {
        if (blocked || (e.target as HTMLElement).closest("[data-no-swipe]")) return;
        const by = wheelStep(e.deltaY, e.timeStamp, lastWheel.current);
        if (by === 0) return;
        lastWheel.current = e.timeStamp;
        step(by);
      }}
      onTouchStart={(e) => {
        if (blocked || (e.target as HTMLElement).closest("[data-no-swipe]") || e.touches.length !== 1) return;
        touch.current = { y: e.touches[0].clientY, at: e.timeStamp };
      }}
      onTouchMove={(e) => {
        if (!touch.current) return;
        setDrag(dragOffset(e.touches[0].clientY - touch.current.y, at, list.length));
      }}
      onTouchEnd={(e) => {
        const from = touch.current;
        touch.current = null;
        setDrag(null);
        if (!from) return;
        const dy = e.changedTouches[0].clientY - from.y;
        const by = swipeStep(dy, e.timeStamp - from.at, stageRef.current?.clientHeight ?? 0);
        if (by !== 0) step(by);
      }}
      onTouchCancel={() => {
        touch.current = null;
        setDrag(null);
      }}
    >
      <div
        className="feed-track"
        data-dragging={drag !== null}
        style={{ transform: `translate3d(0, calc(${-at * 100}% + ${drag ?? 0}px), 0)` }}
      >
        {list.map((clip, i) => {
          const mode = slotMode(i, at);
          if (mode === "off") return null;
          return (
            <div key={clip.id} className="absolute inset-x-0 h-full" style={{ top: `${i * 100}%` }} aria-hidden={mode !== "active"}>
              <ClipSlide
                clip={clip}
                mode={mode}
                muted={muted}
                mediaBase={mediaBase}
                signedIn={signedIn}
                playerRef={mode === "active" ? playerRef : undefined}
                onToggleMute={() => setMuted(!muted)}
              />
            </div>
          );
        })}
      </div>

      {/* Previous and next, for a mouse. Hidden on a phone, where you swipe. */}
      <div className="absolute right-4 top-1/2 z-20 hidden -translate-y-1/2 flex-col gap-3 desk:flex">
        <button
          type="button"
          aria-label="Previous clip"
          disabled={at === 0}
          onClick={() => step(-1)}
          className="grid h-12 w-12 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30"
        >
          <ChevronUpIcon className="h-6 w-6" />
        </button>
        <button
          type="button"
          aria-label="Next clip"
          disabled={at >= list.length - 1}
          onClick={() => step(1)}
          className="grid h-12 w-12 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30"
        >
          <ChevronDownIcon className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
}
