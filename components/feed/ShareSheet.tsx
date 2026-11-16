"use client";

import { useCallback, useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { readCreators, type Creator } from "@/lib/discover/types";
import { socialErrorText } from "@/lib/feed/format";
import { readThreads } from "@/lib/social/messages";
import { useFlag, useSession } from "@/lib/store/session";
import { LinkIcon, ShareIcon } from "@/components/icons";
import type { Clip } from "@/lib/feed/types";
import { callRpc } from "@/lib/social/client";
import { useFeed } from "@/lib/store/feed";
import { useUi } from "@/lib/store/ui";
import { Sheet } from "./Sheet";

/** Share a clip: copy its link, or hand it to the phone's own share sheet. */
export function ShareSheet({ clip, signedIn }: { clip: Clip; signedIn: boolean }) {
  const openSheet = useFeed((s) => s.openSheet);
  const patch = useFeed((s) => s.patch);
  const showToast = useUi((s) => s.showToast);
  const close = useCallback(() => openSheet(null), [openSheet]);
  // The sheet only ever opens after a tap, in the browser, so window is there.
  const [url] = useState(() => `${window.location.origin}/v/${clip.id}`);
  const [canShare] = useState(() => typeof navigator.share === "function");

  // Send to: the people you talked to last, then the people you follow.
  const messagesOn = useFlag("messages") && signedIn;
  const me = useSession((s) => s.user?.username ?? null);
  const [people, setPeople] = useState<Creator[]>([]);
  const [sent, setSent] = useState<Record<string, true>>({});
  useEffect(() => {
    if (!messagesOn || !me) return;
    let cancelled = false;
    void Promise.all([callRpc("dm_threads", { p_limit: 8 }), callRpc<{ people?: unknown } | null>("follow_list", { p_username: me, p_kind: "following", p_limit: 12 })]).then(([threads, following]) => {
      if (cancelled) return;
      const all = [...(threads.ok ? readThreads(threads.data).map((t) => t.with) : []), ...(following.ok ? readCreators(following.data?.people) : [])];
      setPeople(all.filter((p, i) => all.findIndex((x) => x.id === p.id) === i).slice(0, 12));
    });
    return () => {
      cancelled = true;
    };
  }, [messagesOn, me]);

  async function sendTo(person: Creator) {
    setSent((s) => ({ ...s, [person.id]: true }));
    const res = await callRpc("send_message", { p_to: person.id, p_body: "", p_video: clip.id });
    if (res.ok) {
      showToast(`Sent to @${person.username}`);
      counted();
    } else {
      setSent((have) => {
        const next = { ...have };
        delete next[person.id];
        return next;
      });
      showToast(socialErrorText(res.code));
    }
  }

  const counted = () => {
    if (!signedIn) return;
    void callRpc<number | null>("record_share", { p_video: clip.id }).then((res) => {
      if (res.ok && typeof res.data === "number") patch(clip.id, { shareCount: res.data });
    });
  };

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied");
      counted();
      close();
    } catch {
      showToast("Copy the link from the box.");
    }
  }

  async function native() {
    try {
      await navigator.share({ title: `@${clip.author.username} on YapTok`, text: clip.caption, url });
      counted();
      close();
    } catch {
      // The person closed the share sheet: nothing to do.
    }
  }

  return (
    <Sheet title="Share" onClose={close}>
      <div className="space-y-3 p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        {people.length > 0 && (
          <div data-send-to>
            <p className="mb-2 text-[13px] text-text-2">Send to</p>
            <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
              {people.map((p) => (
                <li key={p.id} className="shrink-0">
                  <button type="button" disabled={sent[p.id]} onClick={() => void sendTo(p)} className="flex w-16 flex-col items-center gap-1 text-[12px] text-text disabled:opacity-60">
                    <Avatar name={p.displayName} url={p.avatarUrl} size={48} />
                    <span className="w-full truncate">{sent[p.id] ? "Sent" : p.username}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <input aria-label="Link to this clip" readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="field text-[14px]" data-share-url />
        <div className="flex gap-2">
          <button type="button" onClick={() => void copy()} className="btn-primary flex-1" data-share-copy>
            <LinkIcon className="h-5 w-5" />
            Copy link
          </button>
          {canShare && (
            <button type="button" onClick={() => void native()} className="btn-ghost flex-1">
              <ShareIcon className="h-5 w-5" />
              More
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
