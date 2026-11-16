// The activity inbox as the page shows it: what inbox_page() in 016_inbox.sql
// answers, read field by field, and the sentence for each kind.
// No imports besides the author reader, so the tests load it directly.
import { readAuthor, type ClipAuthor } from "../feed/types.ts";

export type NoticeKind = "like" | "comment" | "reply" | "comment_like" | "follow";

export type Notice = {
  id: number;
  kind: NoticeKind;
  createdAt: string;
  unread: boolean;
  actor: ClipAuthor;
  video: { id: string; caption: string; thumbnailUrl: string | null } | null;
  /** The comment or reply itself, for the kinds that have one. */
  comment: string | null;
};

const KINDS = ["like", "comment", "reply", "comment_like", "follow"];

export function readNotices(value: unknown): Notice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    const r = row && typeof row === "object" ? (row as Record<string, unknown>) : null;
    const actor = readAuthor(r?.actor);
    if (!r || !actor || !KINDS.includes(String(r.kind))) return [];
    const v = r.video && typeof r.video === "object" ? (r.video as Record<string, unknown>) : null;
    return [
      {
        id: Number(r.id) || 0,
        kind: r.kind as NoticeKind,
        createdAt: String(r.created_at ?? ""),
        unread: r.unread === true,
        actor,
        video: v && typeof v.id === "string" ? { id: v.id, caption: typeof v.caption === "string" ? v.caption : "", thumbnailUrl: typeof v.thumbnail_url === "string" ? v.thumbnail_url : null } : null,
        comment: typeof r.comment === "string" ? r.comment : null,
      },
    ];
  });
}

/** What happened, after the name: "liked your clip". */
export function noticeText(kind: NoticeKind): string {
  switch (kind) {
    case "like":
      return "liked your clip";
    case "comment":
      return "commented on your clip";
    case "reply":
      return "replied to your comment";
    case "comment_like":
      return "liked your comment";
    case "follow":
      return "started following you";
  }
}

/** Where a notice leads: the clip it is about, or the person for a follow. */
export function noticeHref(n: Pick<Notice, "kind" | "video" | "actor">): string {
  return n.video ? `/v/${n.video.id}` : `/@${n.actor.username}`;
}

/** The number on the navigation dot: nothing for 0, "9+" past nine. */
export function unreadBadge(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 9 ? "9+" : String(Math.floor(count));
}
