"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Avatar } from "@/components/Avatar";
import { FlagIcon, HeartIcon, TrashIcon, VerifiedIcon } from "@/components/icons";
import { compactCount, socialErrorText, timeAgo } from "@/lib/feed/format";
import { readAuthor, type Clip, type ClipAuthor } from "@/lib/feed/types";
import { callRpc, loginUrl } from "@/lib/social/client";
import { useFeed } from "@/lib/store/feed";
import { useFlag, useSession } from "@/lib/store/session";
import { ReportSheet } from "./ReportSheet";
import { Sheet } from "./Sheet";

type Comment = {
  id: string;
  parentId: string | null;
  body: string;
  createdAt: string;
  likeCount: number;
  replyCount: number;
  liked: boolean;
  author: ClipAuthor;
  mine: boolean;
};

export const COMMENT_MAX = 500;

function readComments(value: unknown): Comment[] {
  if (!Array.isArray(value)) return [];
  const out: Comment[] = [];
  for (const row of value as Record<string, unknown>[]) {
    const author = readAuthor(row?.author);
    if (!author || typeof row.id !== "string" || typeof row.body !== "string") continue;
    out.push({
      id: row.id,
      parentId: typeof row.parent_id === "string" ? row.parent_id : null,
      body: row.body,
      createdAt: String(row.created_at ?? ""),
      likeCount: Math.max(0, Number(row.like_count) || 0),
      replyCount: Math.max(0, Number(row.reply_count) || 0),
      liked: row.liked === true,
      author,
      mine: row.mine === true,
    });
  }
  return out;
}

/**
 * The comment drawer of one clip: newest first, a box to write one, delete
 * for your own comments (and any comment on your own clip), report for the
 * rest. With the comment_threads flag: a heart on every comment, Reply, and
 * the replies of a comment open under it. Writing stops when the owner pauses
 * comments in /admin/settings.
 */
export function CommentsSheet({ clip, signedIn }: { clip: Clip; signedIn: boolean }) {
  const openSheet = useFeed((s) => s.openSheet);
  const patch = useFeed((s) => s.patch);
  const enabled = useSession((s) => s.settings.commentsEnabled);
  const reports = useFlag("reports");
  const threads = useFlag("comment_threads");
  const [items, setItems] = useState<Comment[] | null>(null);
  /** Replies by the id of the comment they hang under, once opened. */
  const [replies, setReplies] = useState<Record<string, Comment[]>>({});
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = useCallback(() => openSheet(null), [openSheet]);

  useEffect(() => {
    let cancelled = false;
    void callRpc("video_comments", { p_video: clip.id, p_limit: 50 }).then((res) => {
      if (cancelled) return;
      if (res.ok) setItems(readComments(res.data));
      else {
        setItems([]);
        setError(socialErrorText(res.code));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [clip.id]);

  /** Changes one comment wherever it is shown. */
  const change = (id: string, fn: (c: Comment) => Comment) => {
    setItems((list) => (list ?? []).map((c) => (c.id === id ? fn(c) : c)));
    setReplies((all) => Object.fromEntries(Object.entries(all).map(([k, list]) => [k, list.map((c) => (c.id === id ? fn(c) : c))])));
  };

  async function openReplies(parent: Comment) {
    const res = await callRpc("comment_replies", { p_comment: parent.id });
    if (!res.ok) return setError(socialErrorText(res.code));
    setReplies((all) => ({ ...all, [parent.id]: readComments(res.data) }));
  }

  async function post(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    const parent = replyTo ? (replyTo.parentId ?? replyTo.id) : null;
    const res = await callRpc("add_comment", { p_video: clip.id, p_body: body, p_parent: parent });
    setBusy(false);
    if (!res.ok) return setError(socialErrorText(res.code));
    const [made] = readComments([res.data]);
    if (made && parent) {
      setReplies((all) => ({ ...all, [parent]: [...(all[parent] ?? []), made] }));
      change(parent, (c) => ({ ...c, replyCount: c.replyCount + 1 }));
    } else if (made) setItems((list) => [made, ...(list ?? [])]);
    setText("");
    setReplyTo(null);
    patch(clip.id, { commentCount: clip.commentCount + 1 });
  }

  async function remove(c: Comment) {
    const res = await callRpc("delete_comment", { p_comment: c.id });
    if (!res.ok) return setError(socialErrorText(res.code));
    // A comment takes its replies with it.
    const gone = 1 + (c.parentId ? 0 : c.replyCount);
    if (c.parentId) {
      setReplies((all) => ({ ...all, [c.parentId!]: (all[c.parentId!] ?? []).filter((r) => r.id !== c.id) }));
      change(c.parentId, (p) => ({ ...p, replyCount: Math.max(0, p.replyCount - 1) }));
    } else setItems((list) => (list ?? []).filter((x) => x.id !== c.id));
    patch(clip.id, { commentCount: Math.max(0, clip.commentCount - gone) });
  }

  function like(c: Comment) {
    if (!signedIn) return;
    const want = !c.liked;
    change(c.id, (x) => ({ ...x, liked: want, likeCount: Math.max(0, x.likeCount + (want ? 1 : -1)) }));
    void callRpc<{ liked: boolean; like_count: number }>("toggle_comment_like", { p_comment: c.id, p_on: want }).then((res) => {
      if (res.ok) change(c.id, (x) => ({ ...x, liked: res.data.liked === true, likeCount: Number(res.data.like_count) || 0 }));
      else {
        change(c.id, (x) => ({ ...x, liked: c.liked, likeCount: c.likeCount }));
        setError(socialErrorText(res.code));
      }
    });
  }

  if (reporting) return <ReportSheet target={{ type: "comment", id: reporting }} onClose={() => setReporting(null)} />;

  const row = (c: Comment, small: boolean) => (
    <div className="flex gap-3" data-comment={c.id}>
      <Avatar name={c.author.displayName} url={c.author.avatarUrl} size={small ? 26 : 32} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 text-[13px] text-text-2">
          <Link href={`/@${c.author.username}`} className="font-medium hover:underline">
            @{c.author.username}
          </Link>
          {c.author.verified && <VerifiedIcon className="h-3.5 w-3.5" />}
          <span>· {timeAgo(c.createdAt)}</span>
        </p>
        <p className="mt-0.5 break-words text-[14px] leading-5 text-text">{c.body}</p>
        <p className="mt-1 flex items-center gap-4 text-[12px] font-medium text-text-2">
          {threads && signedIn && enabled && (
            <button
              type="button"
              data-reply
              onClick={() => {
                setReplyTo(c);
                input.current?.focus();
              }}
              className="hover:text-text"
            >
              Reply
            </button>
          )}
          {c.mine || clip.mine ? (
            <button type="button" aria-label="Delete comment" onClick={() => void remove(c)} className="hover:text-text">
              <TrashIcon className="h-4 w-4" />
            </button>
          ) : (
            reports &&
            signedIn && (
              <button type="button" aria-label="Report comment" onClick={() => setReporting(c.id)} className="hover:text-text">
                <FlagIcon className="h-4 w-4" />
              </button>
            )
          )}
        </p>
      </div>
      {threads && (
        <button
          type="button"
          aria-label={c.liked ? "Unlike comment" : "Like comment"}
          aria-pressed={c.liked}
          data-comment-like
          onClick={() => like(c)}
          disabled={!signedIn}
          className="flex w-9 shrink-0 flex-col items-center gap-0.5 pt-1 text-[11px] text-text-2 disabled:opacity-60"
        >
          <HeartIcon className={`h-5 w-5 ${c.liked ? "text-[var(--accent)]" : "text-text-3"}`} />
          {c.likeCount > 0 && compactCount(c.likeCount)}
        </button>
      )}
    </div>
  );

  return (
    <Sheet title={`Comments (${clip.commentCount})`} onClose={close} tall>
      <ul className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-3" data-comments>
        {items === null && <li className="text-[14px] text-text-2">Loading comments</li>}
        {items?.length === 0 && !error && <li className="py-8 text-center text-[14px] text-text-2">No comments yet. Say something nice.</li>}
        {items?.map((c) => (
          <li key={c.id}>
            {row(c, false)}
            {threads && c.replyCount > 0 && !replies[c.id] && (
              <button type="button" data-open-replies onClick={() => void openReplies(c)} className="ml-11 mt-1 text-[12px] font-medium text-text-2 hover:text-text">
                View {c.replyCount} {c.replyCount === 1 ? "reply" : "replies"}
              </button>
            )}
            {replies[c.id] && replies[c.id].length > 0 && (
              <ul className="ml-11 mt-3 space-y-3" data-replies>
                {replies[c.id].map((r) => (
                  <li key={r.id}>{row(r, true)}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="px-4 pb-1 text-[13px] text-error">
          {error}
        </p>
      )}
      <div className="shrink-0 border-t border-divider p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        {!enabled ? (
          <p className="py-2 text-center text-[14px] text-text-2" data-comments-paused>
            Comments are paused right now.
          </p>
        ) : !signedIn ? (
          <Link href={loginUrl(`/v/${clip.id}`)} className="btn-primary w-full">
            Sign in to comment
          </Link>
        ) : (
          <>
            {replyTo && (
              <p className="mb-2 flex items-center justify-between text-[12px] text-text-2" data-replying>
                <span>Replying to @{replyTo.author.username}</span>
                <button type="button" onClick={() => setReplyTo(null)} className="font-medium hover:text-text">
                  Cancel
                </button>
              </p>
            )}
            <form onSubmit={post} className="flex items-center gap-2">
              <input
                ref={input}
                aria-label={replyTo ? "Write a reply" : "Add a comment"}
                placeholder={replyTo ? "Write a reply" : "Add a comment"}
                className="field !h-10 !rounded-full text-[14px]"
                maxLength={COMMENT_MAX}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <button type="submit" disabled={busy || !text.trim()} className="btn-primary shrink-0">
                Post
              </button>
            </form>
          </>
        )}
      </div>
    </Sheet>
  );
}
