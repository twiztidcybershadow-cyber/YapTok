// Made up rows for the admin panel when `next dev` runs without a database,
// so the panel can be looked at (and filmed) before Supabase is connected.
// Nothing here is real, and nothing can be changed: the pages say so.
// No imports besides the types.
import type { AdminAccount, AdminFlag, AdminLogEntry, AdminReport, AdminSetting, AdminStats, AdminVideo } from "./types.ts";

const owner = { id: "00000000-0000-4000-8000-000000000001", username: "owner" };
const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.UTC(2026, 10, 11, 12) - hours * HOUR).toISOString();

export const previewFlags: AdminFlag[] = [
  ["accounts", "Accounts", "Sign up, sign in, the account menu and settings.", "everyone"],
  ["admin", "Admin panel", "The /admin panel for accounts in the admins table.", "everyone"],
  ["feed", "For You feed", "The full screen vertical feed on the home page.", "everyone"],
  ["upload", "Upload", "The /upload page: pick a clip, caption, hashtags, cover frame.", "test"],
  ["processing", "Processing", "The encoder worker turns uploads into HLS, a cover and a preview sprite.", "test"],
  ["likes", "Likes", "The heart on every clip and the like counts.", "everyone"],
  ["comments", "Comments", "The comment drawer on every clip.", "off"],
  ["follows", "Follows", "The follow button on clips and profiles.", "off"],
].map(([key, label, description, mode], i) => ({
  key,
  label,
  description,
  mode: mode as AdminFlag["mode"],
  testers: mode === "test" ? 1 : 0,
  meListed: mode === "test",
  updatedAt: ago(i * 5 + 1),
  updatedBy: i % 3 === 0 ? null : owner,
}));

export const previewSettings: AdminSetting[] = [
  { key: "upload_max_seconds", label: "Longest clip", description: "The longest a clip can be, in seconds.", kind: "number", value: 60, options: [], min: 3, max: 600, updatedAt: ago(30), updatedBy: null },
  { key: "upload_max_mb", label: "Biggest file", description: "The biggest file one upload can be, in megabytes.", kind: "number", value: 200, options: [], min: 1, max: 2048, updatedAt: ago(30), updatedBy: null },
  { key: "upload_who", label: "Who can upload", description: "Everyone with an account, only verified accounts, or only accounts you invited.", kind: "choice", value: "everyone", options: ["everyone", "verified", "invite"], min: null, max: null, updatedAt: ago(4), updatedBy: owner },
  { key: "comments_enabled", label: "Comments", description: "Switch all commenting off without hiding the comments that are already there.", kind: "boolean", value: true, options: [], min: null, max: null, updatedAt: ago(30), updatedBy: null },
  { key: "signups_open", label: "Sign-ups", description: "When closed, nobody new can make an account.", kind: "boolean", value: true, options: [], min: null, max: null, updatedAt: ago(30), updatedBy: null },
  { key: "maintenance_banner", label: "Banner text", description: "A line shown at the top of every page. Leave it empty for no banner.", kind: "text", value: "", options: [], min: null, max: 200, updatedAt: ago(30), updatedBy: null },
];

const sampleVideo = { id: "00000000-0000-4000-8000-0000000000a1", caption: "A made up clip for the preview", thumbnailUrl: null, removed: false, owner: { id: "00000000-0000-4000-8000-000000000002", username: "sample_creator" } };

export const previewReports: AdminReport[] = [
  { id: "00000000-0000-4000-8000-0000000000b1", targetType: "video", reason: "spam", note: "Looks like an ad.", status: "open", createdAt: ago(2), resolvedAt: null, reporter: { id: "00000000-0000-4000-8000-000000000003", username: "sample_viewer" }, resolvedBy: null, video: sampleVideo, comment: null },
];

export const previewVideos: AdminVideo[] = [
  { id: sampleVideo.id, caption: sampleVideo.caption, hashtags: ["preview"], status: "ready", visibility: "public", thumbnailUrl: null, durationS: 14, error: null, viewCount: 1200, likeCount: 87, commentCount: 5, createdAt: ago(6), removed: false, removedReason: null, owner: sampleVideo.owner, openReports: 1 },
];

export const previewAccounts: AdminAccount[] = [
  { id: owner.id, username: "owner", displayName: "The owner", avatarUrl: null, verified: true, invited: true, onboarded: true, banned: false, bannedReason: null, isAdmin: true, videoCount: 0, followerCount: 0, createdAt: ago(200) },
  { id: sampleVideo.owner.id, username: "sample_creator", displayName: "Sample Creator", avatarUrl: null, verified: false, invited: false, onboarded: true, banned: false, bannedReason: null, isAdmin: false, videoCount: 1, followerCount: 12, createdAt: ago(90) },
];

export const previewLog: AdminLogEntry[] = [
  { id: 2, action: "setting.set", targetType: "setting", targetId: "upload_who", targetName: null, details: { from: "verified", to: "everyone" }, createdAt: ago(4), actor: owner },
  { id: 1, action: "flag.set", targetType: "flag", targetId: "likes", targetName: null, details: { from: "test", to: "everyone" }, createdAt: ago(6), actor: owner },
];

export const previewStats: AdminStats = {
  days: Array.from({ length: 14 }, (_, i) => ({
    day: new Date(Date.UTC(2026, 9, 29 + i)).toISOString().slice(0, 10),
    signups: [1, 0, 2, 1, 3, 2, 4, 3, 5, 4, 6, 5, 8, 7][i],
    uploads: [0, 1, 1, 2, 1, 3, 2, 4, 3, 5, 4, 6, 5, 9][i],
    views: [12, 30, 44, 80, 71, 120, 160, 150, 210, 260, 240, 330, 410, 520][i],
  })),
  totals: { accounts: 51, clips: 46, views: 2638, openReports: 1, banned: 0, inQueue: 0, failed: 0 },
};
