"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { socialErrorText } from "@/lib/feed/format";
import type { Clip } from "@/lib/feed/types";
import { callRpc, loginUrl } from "@/lib/social/client";
import { useFeed } from "@/lib/store/feed";
import { useUi } from "@/lib/store/ui";

/**
 * Like or unlike a clip. The heart changes at once and is put back if the
 * database says no. A signed out person is sent to sign in and back.
 */
export function useLike(signedIn: boolean) {
  const router = useRouter();
  return useCallback(
    (clip: Clip) => {
      if (!signedIn) return router.push(loginUrl(`/v/${clip.id}`));
      const want = !clip.liked;
      const { patch } = useFeed.getState();
      patch(clip.id, { liked: want, likeCount: Math.max(0, clip.likeCount + (want ? 1 : -1)) });
      void callRpc<{ liked: boolean; like_count: number }>("toggle_like", { p_video: clip.id, p_on: want }).then((res) => {
        if (res.ok) patch(clip.id, { liked: res.data.liked === true, likeCount: Number(res.data.like_count) || 0 });
        else {
          patch(clip.id, { liked: clip.liked, likeCount: clip.likeCount });
          useUi.getState().showToast(socialErrorText(res.code));
        }
      });
    },
    [signedIn, router],
  );
}

/** Save a clip for later, or take it out again. Instant, like a like. */
export function useSave(signedIn: boolean) {
  const router = useRouter();
  return useCallback(
    (clip: Clip) => {
      if (!signedIn) return router.push(loginUrl(`/v/${clip.id}`));
      const want = !clip.saved;
      const { patch } = useFeed.getState();
      patch(clip.id, { saved: want, saveCount: Math.max(0, clip.saveCount + (want ? 1 : -1)) });
      void callRpc<{ saved: boolean; save_count: number }>("toggle_save", { p_video: clip.id, p_on: want }).then((res) => {
        if (res.ok) {
          patch(clip.id, { saved: res.data.saved === true, saveCount: Number(res.data.save_count) || 0 });
          if (want) useUi.getState().showToast("Saved. Find it on your profile.");
        } else {
          patch(clip.id, { saved: clip.saved, saveCount: clip.saveCount });
          useUi.getState().showToast(socialErrorText(res.code));
        }
      });
    },
    [signedIn, router],
  );
}

/** Follow or unfollow a creator. Answers the new state through onChange. */
export function useFollow(signedIn: boolean, next: string) {
  const router = useRouter();
  return useCallback(
    async (authorId: string, following: boolean, onChange: (following: boolean, followerCount?: number) => void) => {
      if (!signedIn) return router.push(loginUrl(next));
      const want = !following;
      onChange(want);
      useFeed.getState().setFollowing(authorId, want);
      const res = await callRpc<{ following: boolean; follower_count: number }>("toggle_follow", { p_user: authorId, p_on: want });
      if (res.ok) onChange(res.data.following === true, Number(res.data.follower_count) || 0);
      else {
        onChange(following);
        useFeed.getState().setFollowing(authorId, following);
        useUi.getState().showToast(socialErrorText(res.code));
      }
    },
    [signedIn, next, router],
  );
}
