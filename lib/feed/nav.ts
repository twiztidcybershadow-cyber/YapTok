// How the feed moves: one clip at a time, by swipe, wheel or keys. Pure
// functions from an input to a step, so the tests can check every case
// without a browser. No imports.

export type Step = -1 | 0 | 1;

/** How many clips a page asks for. */
export const FEED_PAGE = 8;
/** Ask for the next page when this few clips are left below the current one. */
export const LOAD_AHEAD = 3;
/** After a wheel step, ignore the wheel for this long: one flick is one clip. */
export const WHEEL_COOLDOWN_MS = 450;
/** Wheel movement smaller than this is a resting finger, not a scroll. */
export const WHEEL_MIN_DELTA = 12;
/** A drag past this share of the stage height changes clip... */
export const SWIPE_DISTANCE = 0.18;
/** ...and so does a short fast flick: at least this many px per ms over 24 px. */
export const SWIPE_VELOCITY = 0.45;
export const SWIPE_MIN_PX = 24;
/** A view counts after this long on a clip, in ms. */
export const VIEW_AFTER_MS = 2000;

export function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(0, Math.floor(index)), count - 1);
}

export type KeyInput = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** The tag of the element the key went to, like "INPUT". */
  targetTag?: string;
  targetEditable?: boolean;
};

export type FeedAction =
  | { type: "step"; step: -1 | 1 }
  | { type: "toggle-play" }
  | { type: "toggle-mute" }
  | { type: "like" }
  | { type: "comments" };

/**
 * The feed's keys:
 *   down, j, PageDown    next clip
 *   up, k, PageUp        previous clip
 *   space                play or pause
 *   m                    sound on or off
 *   l                    like
 *   c                    open the comments
 * Nothing while typing or with a modifier held (browser shortcuts keep
 * working). Space on a focused button presses that button, as everywhere.
 */
export function keyAction(e: KeyInput): FeedAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const tag = (e.targetTag ?? "").toUpperCase();
  if (e.targetEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return null;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  switch (key) {
    case "ArrowDown":
    case "PageDown":
    case "j":
      return { type: "step", step: 1 };
    case "ArrowUp":
    case "PageUp":
    case "k":
      return { type: "step", step: -1 };
    case " ":
    case "Spacebar":
      return tag === "BUTTON" || tag === "A" ? null : { type: "toggle-play" };
    case "m":
      return { type: "toggle-mute" };
    case "l":
      return { type: "like" };
    case "c":
      return { type: "comments" };
  }
  return null;
}

/** One wheel event to a step. `lastStepAt` is when the wheel last moved the feed. */
export function wheelStep(deltaY: number, now: number, lastStepAt: number): Step {
  if (Math.abs(deltaY) < WHEEL_MIN_DELTA) return 0;
  if (now - lastStepAt < WHEEL_COOLDOWN_MS) return 0;
  return deltaY > 0 ? 1 : -1;
}

/**
 * The end of a drag to a step. dy is how far the finger moved (negative is
 * up, which means "next"), ms how long it took, height the stage height.
 */
export function swipeStep(dy: number, ms: number, height: number): Step {
  const distance = Math.abs(dy);
  if (distance < SWIPE_MIN_PX) return 0;
  const far = height > 0 && distance / height >= SWIPE_DISTANCE;
  const fast = ms > 0 && distance / ms >= SWIPE_VELOCITY;
  if (!far && !fast) return 0;
  return dy < 0 ? 1 : -1;
}

/** While dragging, the track follows the finger, with resistance past either end. */
export function dragOffset(dy: number, index: number, count: number): number {
  const pastStart = index === 0 && dy > 0;
  const pastEnd = index >= count - 1 && dy < 0;
  return pastStart || pastEnd ? dy / 3 : dy;
}

export type SlotMode = "active" | "preload" | "poster" | "off";

/**
 * What each clip in the list does while clip `index` is on screen:
 *   active   the one playing
 *   preload  the next one: its stream is opened and buffered, paused
 *   poster   the one before: just its cover, ready for a swipe back
 *   off      everything else: not in the page at all
 */
export function slotMode(i: number, index: number): SlotMode {
  if (i === index) return "active";
  if (i === index + 1) return "preload";
  if (i === index - 1) return "poster";
  return "off";
}

/** Time to fetch the next page? */
export function shouldLoadMore(index: number, count: number, hasMore: boolean, loading: boolean): boolean {
  return hasMore && !loading && count - 1 - index <= LOAD_AHEAD;
}
