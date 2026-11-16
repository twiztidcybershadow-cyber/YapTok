"use client";

import type Hls from "hls.js";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { HeartIcon, PlayIcon } from "@/components/icons";
import { clipLength } from "@/lib/feed/format";
import { DOUBLE_TAP_MS, FAST_RATE, HOLD_MS, holdAction, isDoubleTap, movedTooFar, scrubTime, type HoldAction } from "@/lib/feed/gestures";

/** Safari (desktop and iOS) plays HLS itself; everybody else gets hls.js. */
function preferNative(video: HTMLVideoElement): boolean {
  if (!video.canPlayType("application/vnd.apple.mpegurl")) return false;
  const ua = navigator.userAgent;
  return /safari/i.test(ua) && !/chrome|chromium|crios|android|edg/i.test(ua);
}

export type ClipPlayerHandle = { togglePlay: () => void };

/**
 * One clip's video.
 *   active   the stream is open and playing, on a loop
 *   preload  the stream is open and buffering its first seconds, paused, so
 *            the swipe to it starts at once
 *   poster   only the cover image
 * Browsers only autoplay without sound, so the feed starts muted; the sound
 * button in the feed turns it on for this clip and every one after it.
 * A tap plays or pauses. With `gestures`: a double tap likes (and a single
 * tap waits a moment to see if a second one comes), a held finger pauses, and
 * a finger held on the right third plays at double speed until it lifts.
 * With `scrub` the bar at the bottom can be dragged.
 */
export function ClipPlayer({
  src,
  poster,
  mode,
  muted,
  cover = true,
  gestures = false,
  scrub = false,
  ref,
  onWatched,
  onDoubleTap,
  onSoundBlocked,
}: {
  src: string | null;
  poster: string | null;
  mode: "active" | "preload" | "poster";
  muted: boolean;
  /** Fill the frame (vertical clips) or show the whole picture with bars (wide ones). */
  cover?: boolean;
  /** Double tap to like, hold to pause, hold right for 2x (the gestures flag). */
  gestures?: boolean;
  /** The bar can be dragged (the scrub flag). */
  scrub?: boolean;
  ref?: Ref<ClipPlayerHandle>;
  /** Called with the seconds played when the clip leaves the screen. */
  onWatched?: (seconds: number) => void;
  onDoubleTap?: () => void;
  /** The browser refused to start with sound: the player muted itself. */
  onSoundBlocked?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const [held, setHeld] = useState<HoldAction | null>(null);
  const [burst, setBurst] = useState(0);
  const [scrubbing, setScrubbing] = useState<{ at: number; total: number } | null>(null);
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> | undefined } | null>(null);
  const lastTap = useRef(0);
  const single = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const swallowClick = useRef(false);
  const open = mode !== "poster" && src !== null;
  const active = mode === "active";

  // Open the stream for the clip on screen and the next one; let it go otherwise.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !open || !src) return;
    let hls: Hls | null = null;
    let cancelled = false;
    setFailed(false);
    if (preferNative(video)) {
      video.preload = "auto";
      video.src = src;
    } else {
      void import("hls.js").then(({ default: HlsClass }) => {
        if (cancelled) return;
        if (!HlsClass.isSupported()) {
          video.src = src;
          return;
        }
        // A short clip: a small buffer is plenty, and keeps the next clip's preload cheap.
        hls = new HlsClass({ maxBufferLength: 10, backBufferLength: 10, capLevelToPlayerSize: true });
        hls.on(HlsClass.Events.ERROR, (_e, data) => {
          if (!data.fatal || !hls) return;
          if (data.type === HlsClass.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else setFailed(true);
        });
        hls.loadSource(new URL(src, window.location.href).toString());
        hls.attachMedia(video);
      });
    }
    return () => {
      cancelled = true;
      video.pause();
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
      setProgress(0);
    };
  }, [open, src]);

  // Play while on screen; pause and rewind when it is the one waiting.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !open) return;
    if (!active) {
      video.pause();
      return;
    }
    let cancelled = false;
    const play = () => {
      video.play().catch((err: unknown) => {
        if (cancelled) return;
        // Sound without a tap was refused (a fresh visit): start muted instead.
        // Only that refusal: a play() cut short by the stream attaching is not one.
        if (!video.muted && err instanceof DOMException && err.name === "NotAllowedError") {
          video.muted = true;
          onSoundBlocked?.();
          video.play().catch(() => !cancelled && setPaused(true));
        } else if (!(err instanceof DOMException && err.name === "AbortError")) setPaused(true);
      });
    };
    play();
    // The stream may not be attached yet on the first clip: try again when it can play.
    video.addEventListener("canplay", play, { once: true });
    return () => {
      cancelled = true;
      video.removeEventListener("canplay", play);
      onWatched?.(video.currentTime);
      video.pause();
      try {
        video.currentTime = 0;
      } catch {
        // Not seekable yet: nothing to rewind.
      }
    };
    // onWatched is read when the clip leaves; a new function must not restart playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted, mode]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video || !active) return;
    if (video.paused) void video.play().catch(() => setPaused(true));
    else video.pause();
  };
  useImperativeHandle(ref, () => ({ togglePlay }));

  const endHold = () => {
    const video = videoRef.current;
    clearTimeout(press.current?.timer);
    press.current = null;
    if (!held || !video) return;
    if (held === "fast") video.playbackRate = 1;
    else void video.play().catch(() => setPaused(true));
    setHeld(null);
    // The lift that ends a hold is not a tap.
    swallowClick.current = true;
  };

  const seekTo = (clientX: number, bar: HTMLElement) => {
    const video = videoRef.current;
    if (!video) return;
    const box = bar.getBoundingClientRect();
    const t = scrubTime(clientX, box.left, box.width, video.duration);
    video.currentTime = t;
    setScrubbing({ at: t, total: video.duration });
    setProgress(video.duration > 0 ? t / video.duration : 0);
  };

  return (
    <div className="absolute inset-0" data-clip-player={mode}>
      <video
        ref={videoRef}
        poster={poster ?? undefined}
        loop
        playsInline
        muted={muted}
        preload="none"
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (v.duration > 0) setProgress(v.currentTime / v.duration);
        }}
        className={`h-full w-full bg-black ${cover ? "object-cover" : "object-contain"}`}
      />
      <button
        type="button"
        aria-label={paused ? "Play" : "Pause"}
        data-clip-tap
        data-held={held ?? undefined}
        className="absolute inset-0 cursor-pointer select-none [-webkit-touch-callout:none]"
        onContextMenu={(e) => gestures && e.preventDefault()}
        onPointerDown={(e) => {
          if (!gestures || !active) return;
          const box = e.currentTarget.getBoundingClientRect();
          const action = holdAction(e.clientX - box.left, box.width);
          const timer = setTimeout(() => {
            const video = videoRef.current;
            if (!video || video.paused) return;
            if (action === "fast") video.playbackRate = FAST_RATE;
            else video.pause();
            setHeld(action);
          }, HOLD_MS);
          press.current = { x: e.clientX, y: e.clientY, timer };
        }}
        onPointerMove={(e) => {
          const p = press.current;
          if (p && !held && movedTooFar(e.clientX - p.x, e.clientY - p.y)) {
            clearTimeout(p.timer);
            press.current = null;
          }
        }}
        onPointerUp={endHold}
        onPointerCancel={endHold}
        onPointerLeave={endHold}
        onClick={(e) => {
          if (swallowClick.current) {
            swallowClick.current = false;
            return;
          }
          // The keyboard (detail 0) and players without gestures act at once.
          if (!gestures || e.detail === 0) return togglePlay();
          clearTimeout(single.current);
          if (isDoubleTap(e.timeStamp, lastTap.current)) {
            lastTap.current = 0;
            setBurst((n) => n + 1);
            onDoubleTap?.();
            return;
          }
          lastTap.current = e.timeStamp;
          single.current = setTimeout(togglePlay, DOUBLE_TAP_MS);
        }}
      >
        {burst > 0 && (
          <span key={burst} aria-hidden data-heart-burst className="heart-burst pointer-events-none absolute left-1/2 top-1/2">
            <HeartIcon className="h-28 w-28 text-[var(--accent)] drop-shadow-lg" />
          </span>
        )}
        {held === "fast" && (
          <span className="over-video absolute left-1/2 top-6 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-[13px] font-medium text-white">2x speed</span>
        )}
        {active && paused && !held && scrubbing === null && !failed && src && (
          <span className="absolute left-1/2 top-1/2 grid h-[72px] w-[72px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45">
            <PlayIcon className="h-10 w-10 text-white" />
          </span>
        )}
      </button>
      {(failed || !src) && active && (
        <p className="over-video pointer-events-none absolute inset-x-6 top-1/2 -translate-y-1/2 text-center text-[14px] text-white">
          This clip can&apos;t play right now.
        </p>
      )}
      {active && !scrub && (
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-white/25">
          <div className="h-full bg-[var(--brand)]" style={{ width: `${Math.round(progress * 1000) / 10}%` }} />
        </div>
      )}
      {active && scrub && (
        // A tall touch target around a thin bar. Drags here move through the clip, not the feed.
        <div
          role="slider"
          tabIndex={0}
          aria-label="Position in the clip"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          data-no-swipe
          data-scrub
          className="group absolute inset-x-0 bottom-0 flex h-6 cursor-pointer touch-none items-end"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            seekTo(e.clientX, e.currentTarget);
          }}
          onPointerMove={(e) => scrubbing !== null && seekTo(e.clientX, e.currentTarget)}
          onPointerUp={() => setScrubbing(null)}
          onPointerCancel={() => setScrubbing(null)}
          onKeyDown={(e) => {
            const video = videoRef.current;
            if (!video || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
            e.preventDefault();
            video.currentTime = Math.min(video.duration || 0, Math.max(0, video.currentTime + (e.key === "ArrowRight" ? 2 : -2)));
          }}
        >
          {scrubbing !== null && (
            <span className="over-video absolute bottom-8 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[14px] font-medium tabular-nums text-white">
              {clipLength(scrubbing.at)} / {clipLength(scrubbing.total)}
            </span>
          )}
          <div className={`w-full bg-white/25 transition-[height] group-hover:h-[6px] ${scrubbing !== null ? "h-[6px]" : "h-[3px]"}`}>
            <div className="h-full bg-[var(--brand)]" style={{ width: `${Math.round(progress * 1000) / 10}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
