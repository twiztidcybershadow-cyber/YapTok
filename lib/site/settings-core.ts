// The site settings the owner changes at /admin/settings, as the pages use
// them. The rows live in public.site_settings (002_admin.sql); the database
// reads the same rows when it checks an upload or a comment.
// No imports on purpose, so `node --test` can load it directly.

export type UploadWho = "everyone" | "verified" | "invite";

export type PublicSettings = {
  /** The longest a clip can be, in seconds. */
  uploadMaxSeconds: number;
  /** The biggest file one upload can be, in megabytes. */
  uploadMaxMb: number;
  uploadDailyLimit: number;
  uploadWho: UploadWho;
  commentsEnabled: boolean;
  signupsOpen: boolean;
  /** A line shown at the top of every page, or "" for none. */
  banner: string;
};

/** Used when the settings cannot be read. Keep in step with the seed rows in 002_admin.sql. */
export const DEFAULT_SETTINGS: PublicSettings = {
  uploadMaxSeconds: 60,
  uploadMaxMb: 200,
  uploadDailyLimit: 10,
  uploadWho: "everyone",
  commentsEnabled: true,
  signupsOpen: true,
  banner: "",
};

type Row = { key: string; value: unknown };

function int(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

/** Rows of site_settings to typed settings. Anything odd falls back to the default. */
export function readSettings(rows: Row[] | null | undefined): PublicSettings {
  const by = new Map((rows ?? []).map((r) => [r.key, r.value]));
  const d = DEFAULT_SETTINGS;
  const who = by.get("upload_who");
  const banner = by.get("maintenance_banner");
  return {
    uploadMaxSeconds: int(by.get("upload_max_seconds"), d.uploadMaxSeconds, 3, 600),
    uploadMaxMb: int(by.get("upload_max_mb"), d.uploadMaxMb, 1, 2048),
    uploadDailyLimit: int(by.get("upload_daily_limit"), d.uploadDailyLimit, 1, 200),
    uploadWho: who === "verified" || who === "invite" ? who : "everyone",
    commentsEnabled: by.get("comments_enabled") !== false,
    signupsOpen: by.get("signups_open") !== false,
    banner: typeof banner === "string" ? banner.trim().slice(0, 200) : "",
  };
}

/** "Everyone", "Verified accounts only", "Invited accounts only". */
export function uploadWhoText(who: UploadWho): string {
  if (who === "verified") return "Verified accounts only";
  if (who === "invite") return "Invited accounts only";
  return "Everyone";
}
