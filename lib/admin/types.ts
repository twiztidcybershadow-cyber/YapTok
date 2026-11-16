// What the admin panel reads and how it words things. Pure functions over the
// answers of the admin_* functions in 009_admin_panel.sql, so the tests can
// check them without a database. No imports.

export type FlagMode = "off" | "test" | "everyone";
export type Who = { id: string; username: string } | null;

export type AdminFlag = {
  key: string;
  label: string;
  description: string;
  mode: FlagMode;
  /** How many accounts are listed for test mode, and whether this admin is one. */
  testers: number;
  meListed: boolean;
  updatedAt: string | null;
  updatedBy: Who;
};

export type SettingKind = "number" | "choice" | "boolean" | "text";
export type AdminSetting = {
  key: string;
  label: string;
  description: string;
  kind: SettingKind;
  value: number | string | boolean;
  options: string[];
  min: number | null;
  max: number | null;
  updatedAt: string | null;
  updatedBy: Who;
};

export type AdminReport = {
  id: string;
  targetType: "video" | "comment";
  reason: string;
  note: string;
  status: "open" | "actioned" | "dismissed";
  createdAt: string;
  resolvedAt: string | null;
  reporter: Who;
  resolvedBy: Who;
  video: { id: string; caption: string; thumbnailUrl: string | null; removed: boolean; owner: Who };
  comment: { id: string; body: string; removed: boolean; author: Who } | null;
};

export type AdminVideo = {
  id: string;
  caption: string;
  hashtags: string[];
  status: string;
  visibility: string;
  thumbnailUrl: string | null;
  durationS: number | null;
  error: string | null;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  removed: boolean;
  removedReason: string | null;
  owner: Who;
  openReports: number;
};

export type AdminAccount = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  verified: boolean;
  invited: boolean;
  onboarded: boolean;
  banned: boolean;
  bannedReason: string | null;
  isAdmin: boolean;
  videoCount: number;
  followerCount: number;
  createdAt: string;
};

export type AdminLogEntry = {
  id: number;
  action: string;
  targetType: string;
  targetId: string;
  targetName: string | null;
  details: Record<string, unknown>;
  createdAt: string;
  actor: Who;
};

export type StatDay = { day: string; signups: number; uploads: number; views: number };
export type AdminStats = {
  days: StatDay[];
  totals: { accounts: number; clips: number; views: number; openReports: number; banned: number; inQueue: number; failed: number };
};

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number => Math.max(0, Math.floor(Number(v) || 0));
const list = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(rec).filter((r): r is Rec => r !== null) : []);

export function readWho(v: unknown): Who {
  const r = rec(v);
  return r && str(r.id) && str(r.username) ? { id: str(r.id), username: str(r.username) } : null;
}

export function readFlags(v: unknown): AdminFlag[] {
  return list(v)
    .filter((r) => str(r.key) && ["off", "test", "everyone"].includes(str(r.mode)))
    .map((r) => ({
      key: str(r.key),
      label: str(r.label) || str(r.key),
      description: str(r.description),
      mode: str(r.mode) as FlagMode,
      testers: num(r.testers),
      meListed: r.me_listed === true,
      updatedAt: strOrNull(r.updated_at),
      updatedBy: readWho(r.updated_by),
    }));
}

export function readSettingRows(v: unknown): AdminSetting[] {
  return list(v)
    .filter((r) => str(r.key) && ["number", "choice", "boolean", "text"].includes(str(r.kind)))
    .map((r) => ({
      key: str(r.key),
      label: str(r.label) || str(r.key),
      description: str(r.description),
      kind: str(r.kind) as SettingKind,
      value: typeof r.value === "number" || typeof r.value === "boolean" || typeof r.value === "string" ? r.value : "",
      options: Array.isArray(r.options) ? r.options.filter((o): o is string => typeof o === "string") : [],
      min: typeof r.min === "number" ? r.min : null,
      max: typeof r.max === "number" ? r.max : null,
      updatedAt: strOrNull(r.updated_at),
      updatedBy: readWho(r.updated_by),
    }));
}

export function readReports(v: unknown): AdminReport[] {
  return list(v).flatMap((r) => {
    const video = rec(r.video);
    if (!str(r.id) || !video) return [];
    const comment = rec(r.comment);
    const status = str(r.status);
    return [
      {
        id: str(r.id),
        targetType: r.target_type === "comment" ? ("comment" as const) : ("video" as const),
        reason: str(r.reason),
        note: str(r.note),
        status: status === "actioned" || status === "dismissed" ? status : ("open" as const),
        createdAt: str(r.created_at),
        resolvedAt: strOrNull(r.resolved_at),
        reporter: readWho(r.reporter),
        resolvedBy: readWho(r.resolved_by),
        video: { id: str(video.id), caption: str(video.caption), thumbnailUrl: strOrNull(video.thumbnail_url), removed: video.removed === true, owner: readWho(video.owner) },
        comment: comment ? { id: str(comment.id), body: str(comment.body), removed: comment.removed === true, author: readWho(comment.author) } : null,
      },
    ];
  });
}

export function readVideos(v: unknown): AdminVideo[] {
  return list(v)
    .filter((r) => str(r.id))
    .map((r) => ({
      id: str(r.id),
      caption: str(r.caption),
      hashtags: Array.isArray(r.hashtags) ? r.hashtags.filter((t): t is string => typeof t === "string") : [],
      status: str(r.status),
      visibility: str(r.visibility),
      thumbnailUrl: strOrNull(r.thumbnail_url),
      durationS: r.duration_s === null || r.duration_s === undefined ? null : Number(r.duration_s),
      error: strOrNull(r.error),
      viewCount: num(r.view_count),
      likeCount: num(r.like_count),
      commentCount: num(r.comment_count),
      createdAt: str(r.created_at),
      removed: r.removed === true,
      removedReason: strOrNull(r.removed_reason),
      owner: readWho(r.owner),
      openReports: num(r.open_reports),
    }));
}

export function readAccounts(v: unknown): AdminAccount[] {
  return list(v)
    .filter((r) => str(r.id) && str(r.username))
    .map((r) => ({
      id: str(r.id),
      username: str(r.username),
      displayName: str(r.display_name) || str(r.username),
      avatarUrl: strOrNull(r.avatar_url),
      verified: r.verified === true,
      invited: r.invited === true,
      onboarded: r.onboarded === true,
      banned: r.banned === true,
      bannedReason: strOrNull(r.banned_reason),
      isAdmin: r.is_admin === true,
      videoCount: num(r.video_count),
      followerCount: num(r.follower_count),
      createdAt: str(r.created_at),
    }));
}

export function readLog(v: unknown): AdminLogEntry[] {
  return list(v)
    .filter((r) => str(r.action))
    .map((r) => ({
      id: num(r.id),
      action: str(r.action),
      targetType: str(r.target_type),
      targetId: str(r.target_id),
      targetName: strOrNull(r.target_name),
      details: rec(r.details) ?? {},
      createdAt: str(r.created_at),
      actor: readWho(r.actor),
    }));
}

export function readStats(v: unknown): AdminStats {
  const r = rec(v) ?? {};
  const t = rec(r.totals) ?? {};
  return {
    days: list(r.days)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(str(d.day)))
      .map((d) => ({ day: str(d.day), signups: num(d.signups), uploads: num(d.uploads), views: num(d.views) })),
    totals: {
      accounts: num(t.accounts),
      clips: num(t.clips),
      views: num(t.views),
      openReports: num(t.open_reports),
      banned: num(t.banned),
      inQueue: num(t.in_queue),
      failed: num(t.failed),
    },
  };
}

/** The flags whose key, name or description contains every word typed in the search box. */
export function filterFlags<T extends { key: string; label: string; description: string }>(flags: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return flags;
  return flags.filter((f) => {
    const hay = `${f.key} ${f.label} ${f.description}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export const MODE_LABELS: Record<FlagMode, string> = { off: "Off", test: "Test", everyone: "Everyone" };

/** Who sees a flag in this mode, in a few words. */
export function modeHint(flag: Pick<AdminFlag, "mode" | "testers" | "meListed">): string {
  if (flag.mode === "everyone") return "On for everyone";
  if (flag.mode === "off") return "Off for everyone";
  const others = flag.testers - (flag.meListed ? 1 : 0);
  if (flag.meListed) return others > 0 ? `On for you and ${others} more tester${others === 1 ? "" : "s"}` : "On for you only";
  return `On for ${flag.testers} tester${flag.testers === 1 ? "" : "s"}, not you. Press Test to add yourself`;
}

/** A setting's value the way a person would say it. */
export function settingValueText(key: string, value: unknown): string {
  if (typeof value === "boolean") {
    if (key === "signups_open") return value ? "open" : "closed";
    return value ? "on" : "off";
  }
  if (typeof value === "string") return value === "" ? "(empty)" : `"${value}"`;
  return String(value);
}

/** One audit log entry as a sentence, without the actor: "switched Likes to everyone". */
export function logText(e: Pick<AdminLogEntry, "action" | "targetId" | "targetName" | "details">): string {
  const d = e.details;
  const name = e.targetName ?? e.targetId;
  const reason = typeof d.reason === "string" && d.reason ? ` (${d.reason})` : "";
  switch (e.action) {
    case "flag.set":
      return `switched the ${e.targetId} flag from ${String(d.from ?? "?")} to ${String(d.to ?? "?")}`;
    case "setting.set":
      return `changed ${e.targetId} from ${settingValueText(e.targetId, d.from)} to ${settingValueText(e.targetId, d.to)}`;
    case "video.remove":
      return `removed the clip ${name}${reason}`;
    case "video.restore":
      return `restored the clip ${name}`;
    case "comment.remove":
      return `removed a comment`;
    case "comment.restore":
      return `restored a comment`;
    case "report.dismiss":
      return `dismissed a report`;
    case "account.ban":
      return `banned ${name}${reason}`;
    case "account.unban":
      return `unbanned ${name}`;
    case "account.verified":
      return d.on === false ? `took the verified mark from ${name}` : `verified ${name}`;
    case "account.invited":
      return d.on === false ? `took the invite from ${name}` : `invited ${name} to upload`;
    default:
      return `${e.action} ${name}`.trim();
  }
}

/** Friendly text for the error codes the admin functions raise. */
export function adminErrorText(code: string | null | undefined): string {
  switch (code) {
    case "not_signed_in":
      return "Your session ended. Sign in again.";
    case "not_admin":
      return "Only admins can do that.";
    case "locked":
      return "The admin panel's own flag cannot be switched off from here.";
    case "bad_value":
      return "That value is not allowed for this setting.";
    case "bad_mode":
      return "Pick off, test or everyone.";
    case "self":
      return "You cannot ban yourself.";
    case "is_admin":
      return "That account is an admin. Take it out of the admins table first.";
    case "not_found":
      return "That is not there any more. Reload the page.";
    case "no_db":
      return "database not connected";
    default:
      return "Something went wrong. Try again.";
  }
}

/** The top of a chart's scale: a round number at or above the biggest value, at least 4. */
export function niceMax(values: number[]): number {
  const max = Math.max(0, ...values);
  if (max <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 4, 5, 10]) if (m * pow >= max) return m * pow;
  return 10 * pow;
}

/** "2026-11-11" to "Nov 11". */
export function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
