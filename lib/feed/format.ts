// Small text helpers for counts and times. No imports, so the tests load it directly.

/** 0, 999, 1.2K, 15K, 3.4M: at most four characters. */
export function compactCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.floor(n));
  const units: [number, string][] = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, letter] of units) {
    if (n >= size) {
      const v = n / size;
      // Round down so 1,999 is "1.9K", never "2.0K".
      const text = v < 10 ? (Math.floor(v * 10) / 10).toFixed(1).replace(/\.0$/, "") : String(Math.floor(v));
      return text + letter;
    }
  }
  return String(Math.floor(n));
}

/** "now", "5m", "3h", "2d", "4w", then a date like "Mar 3, 2026". */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  if (s < 35 * 86400) return `${Math.floor(s / (7 * 86400))}w`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** 75.4 -> "1:15". */
export function clipLength(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Friendly text for the error codes the social functions raise (006, 007, 008). */
export function socialErrorText(code: string | null | undefined): string {
  switch (code) {
    case "not_signed_in":
      return "Sign in first.";
    case "banned":
      return "This account has been banned.";
    case "not_onboarded":
      return "Finish setting up your account first.";
    case "comments_off":
      return "Comments are switched off right now.";
    case "likes_off":
    case "follows_off":
    case "message_invalid":
      return "Write a message of 1 to 1000 characters.";
    case "messages_off":
    case "replies_off":
    case "saves_off":
    case "reports_off":
      return "This is switched off right now.";
    case "comment_invalid":
      return "Write a comment of 1 to 500 characters.";
    case "slow_down":
      return "That was fast. Wait a moment and try again.";
    case "not_found":
      return "This clip is not available any more.";
    case "self":
      return "That is you.";
    case "no_db":
      return "database not connected";
    default:
      return "Something went wrong. Try again.";
  }
}

/** The code inside a Supabase RPC error (the functions raise their code as the message). */
export function rpcCode(error: { message?: string } | null | undefined): string | null {
  if (!error) return null;
  const m = error.message ?? "";
  return /^[a-z_]{3,40}$/.test(m) ? m : "error";
}
