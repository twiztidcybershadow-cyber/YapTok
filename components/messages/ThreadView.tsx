"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Avatar } from "@/components/Avatar";
import { VerifiedIcon } from "@/components/icons";
import type { Creator } from "@/lib/discover/types";
import { socialErrorText, timeAgo } from "@/lib/feed/format";
import { callRpc } from "@/lib/social/client";
import { MESSAGE_MAX, mergeMessages, readMessage, readThread, type Message } from "@/lib/social/messages";

/** How often an open conversation asks for new messages, in ms. */
const POLL_MS = 4000;

/**
 * One conversation: the messages oldest first, yours on the right, a box to
 * write. A sent message shows at once and is confirmed when the database
 * answers. The page asks for new messages every few seconds while it is open.
 */
export function ThreadView({ person, initial }: { person: Creator; initial: Message[] }) {
  const [messages, setMessages] = useState(initial);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const count = messages.length;

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [count]);

  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden) return;
      void callRpc("dm_thread", { p_username: person.username }).then((res) => {
        const thread = res.ok ? readThread(res.data) : null;
        if (thread) setMessages((have) => mergeMessages(have, thread.messages));
      });
    }, POLL_MS);
    return () => clearInterval(t);
  }, [person.username]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setError(null);
    setText("");
    const temp: Message = { id: -Date.now(), body, createdAt: new Date().toISOString(), mine: true, video: null, hadVideo: false, pending: true };
    setMessages((have) => [...have, temp]);
    const res = await callRpc("send_message", { p_to: person.id, p_body: body });
    const saved = res.ok ? readMessage(res.data) : null;
    setMessages((have) => (saved ? mergeMessages(have.filter((m) => m.id !== temp.id), [saved]) : have.filter((m) => m.id !== temp.id)));
    if (!saved) {
      setText(body);
      setError(socialErrorText(res.ok ? null : res.code));
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-var(--bottom-bar)-var(--banner,0px))] max-w-[640px] flex-col" data-thread={person.username}>
      <header className="flex shrink-0 items-center gap-3 border-b border-divider px-4 py-3">
        <Link href="/messages" aria-label="Back to messages" className="text-[14px] text-text-2 hover:underline">
          Back
        </Link>
        <Link href={`/@${person.username}`} className="flex min-w-0 items-center gap-2">
          <Avatar name={person.displayName} url={person.avatarUrl} size={36} />
          <span className="flex min-w-0 items-center gap-1 text-[15px] font-medium text-text">
            <span className="truncate">{person.displayName}</span>
            {person.verified && <VerifiedIcon className="h-4 w-4 shrink-0" />}
          </span>
        </Link>
      </header>

      <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 py-4" data-messages>
        {messages.length === 0 && <li className="py-12 text-center text-[14px] text-text-2">Say hi to @{person.username}.</li>}
        {messages.map((m) => (
          <li key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`} data-message={m.mine ? "mine" : "theirs"}>
            <div className={`max-w-[78%] ${m.pending ? "opacity-60" : ""}`}>
              {m.video ? (
                <Link href={`/v/${m.video.id}`} prefetch={false} className="mb-1 block w-[132px] overflow-hidden rounded-xl bg-skeleton" data-message-clip>
                  {m.video.thumbnailUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- covers come from the media bucket, whose address is only known at request time
                    <img src={m.video.thumbnailUrl} alt="" className="aspect-[9/16] w-full object-cover" />
                  )}
                  <span className="block truncate px-2 py-1.5 text-[12px] text-text-2">@{m.video.username}</span>
                </Link>
              ) : (
                m.hadVideo && <p className="mb-1 rounded-xl bg-hover px-3 py-2 text-[13px] text-text-2">This clip is not available any more.</p>
              )}
              {m.body && (
                <p className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[15px] leading-5 ${m.mine ? "bg-[var(--brand-strong)] text-white" : "bg-hover text-text"}`}>{m.body}</p>
              )}
              <p className={`mt-0.5 text-[11px] text-text-3 ${m.mine ? "text-right" : ""}`}>{m.pending ? "Sending" : timeAgo(m.createdAt)}</p>
            </div>
          </li>
        ))}
        <div ref={end} />
      </ol>

      {error && (
        <p role="alert" className="px-4 pb-1 text-[13px] text-error">
          {error}
        </p>
      )}
      <form onSubmit={send} className="flex shrink-0 items-center gap-2 border-t border-divider p-3">
        <input aria-label="Message" placeholder="Message" className="field !h-11 !rounded-full text-[15px]" maxLength={MESSAGE_MAX} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        <button type="submit" disabled={!text.trim()} className="btn-primary shrink-0">
          Send
        </button>
      </form>
    </div>
  );
}
