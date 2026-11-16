// The player's touch rules: what a tap, a second tap, a held finger and a drag
// on the bar mean. Pure functions, so the tests check every case without a
// browser. No imports.

/** Two taps within this many ms are a double tap (a like). A single tap waits this long before it pauses. */
export const DOUBLE_TAP_MS = 260;
/** A finger held still this long is a hold. */
export const HOLD_MS = 350;
/** A finger that moved this far is a swipe, not a tap or a hold. */
export const MOVE_CANCEL_PX = 10;
/** Holding this share of the width from the right edge plays at double speed; the rest pauses. */
export const FAST_ZONE = 1 / 3;
export const FAST_RATE = 2;

/** Is this tap the second of a double tap? lastTapAt is 0 when there was none. */
export function isDoubleTap(now: number, lastTapAt: number): boolean {
  return lastTapAt > 0 && now - lastTapAt <= DOUBLE_TAP_MS;
}

/** Did the finger move too far to still count as a tap or a hold? */
export function movedTooFar(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > MOVE_CANCEL_PX;
}

export type HoldAction = "pause" | "fast";

/** What holding at x does, in a player `width` px wide. */
export function holdAction(x: number, width: number): HoldAction {
  return width > 0 && x >= width * (1 - FAST_ZONE) ? "fast" : "pause";
}

/** Where in the clip a point on the scrub bar is, in seconds. */
export function scrubTime(x: number, left: number, width: number, duration: number): number {
  if (!(width > 0) || !Number.isFinite(duration) || duration <= 0) return 0;
  const share = Math.min(1, Math.max(0, (x - left) / width));
  return Math.round(share * duration * 100) / 100;
}

/** What the sound button remembered from the last visit: true is muted. Anything unknown is muted. */
export function readMutedPref(stored: string | null): boolean {
  return stored !== "on";
}
