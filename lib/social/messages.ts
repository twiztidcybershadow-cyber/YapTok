// Direct messages as the pages show them: what dm_threads() and dm_thread()
// in 017_messages.sql answer, read field by field.
// No imports besides the readers, so the tests load it directly.
import { readCreators, type Creator } from "../discover/types.ts";

export const MESSAGE_MAX = 1000;

export type Message = {
  id: number;
  body: string;
  createdAt: string;
  mine: boolean;
  /** The clip sent along, or null. hadVideo says one was sent but is gone now. */
  video: { id: string; caption: string; thumbnailUrl: string | null; username: string } | null;
  hadVideo: boolean;
  /** Not saved yet: shown at once, confirmed when the server answers. */
  pending?: boolean;
};

export type Thread = { with: Creator; last: Message; unread: number };

const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function readMessage(value: unknown): Message | null {
  const r = rec(value);
  if (!r || typeof r.body !== "string") return null;
  const v = rec(r.video);
  return {
    id: Number(r.id) || 0,
    body: r.body,
    createdAt: String(r.created_at ?? ""),
    mine: r.mine === true,
    video:
      v && typeof v.id === "string"
        ? { id: v.id, caption: typeof v.caption === "string" ? v.caption : "", thumbnailUrl: typeof v.thumbnail_url === "string" ? v.thumbnail_url : null, username: typeof v.username === "string" ? v.username : "" }
        : null,
    hadVideo: r.had_video === true,
  };
}

export function readMessages(value: unknown): Message[] {
  return Array.isArray(value) ? value.map(readMessage).filter((m): m is Message => m !== null) : [];
}

export function readThreads(value: unknown): Thread[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    const r = rec(row);
    const [person] = readCreators([r?.with]);
    const last = readMessage(r?.last);
    return r && person && last ? [{ with: person, last, unread: Math.max(0, Number(r.unread) || 0) }] : [];
  });
}

export function readThread(value: unknown): { with: Creator; messages: Message[] } | null {
  const r = rec(value);
  const [person] = readCreators([r?.with]);
  return r && person ? { with: person, messages: readMessages(r.messages) } : null;
}

/** The one line under a name in the list of conversations. */
export function previewText(m: Pick<Message, "body" | "mine" | "video" | "hadVideo">): string {
  const what = m.body || (m.video || m.hadVideo ? "Sent a clip" : "");
  return m.mine ? `You: ${what}` : what;
}

/** New messages from a fresh poll, added to what is on screen without repeats, pending ones dropped once confirmed. */
export function mergeMessages(have: Message[], fresh: Message[]): Message[] {
  const ids = new Set(fresh.map((m) => m.id));
  const kept = have.filter((m) => !ids.has(m.id) && !(m.pending && fresh.some((f) => f.mine && f.body === m.body && f.video?.id === m.video?.id)));
  return [...kept, ...fresh].sort((a, b) => (a.pending ? 1 : 0) - (b.pending ? 1 : 0) || a.id - b.id);
}
