// How the feed moves and what it shows: lib/feed/nav.ts, types.ts, format.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { clipLength, compactCount, rpcCode, socialErrorText, timeAgo } from "../lib/feed/format.ts";
import { clampIndex, dragOffset, keyAction, shouldLoadMore, slotMode, swipeStep, wheelStep, WHEEL_COOLDOWN_MS } from "../lib/feed/nav.ts";
import { clipSources, feedCursor, mergeClips, readClip, readClips } from "../lib/feed/types.ts";

const row = (n, extra = {}) => ({
  id: `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, "0")}`,
  caption: `clip ${n}`,
  hashtags: ["a"],
  visibility: "public",
  status: "ready",
  duration_s: "7.5",
  width: 720,
  height: 1280,
  hls_key: `hls/aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, "0")}/master.m3u8`,
  thumbnail_url: null,
  like_count: 3,
  comment_count: "2",
  view_count: 10,
  share_count: 0,
  save_count: 4,
  saved: true,
  published_at: `2026-11-0${n}T10:00:00Z`,
  created_at: `2026-11-0${n}T09:00:00Z`,
  removed: false,
  author: { id: "11111111-2222-4333-8444-555555555555", username: "mira", display_name: "", avatar_url: null, verified: true },
  liked: true,
  following: false,
  mine: false,
  ...extra,
});

test("keys: arrows, j and k step; space plays; m, l and c do their thing", () => {
  assert.deepEqual(keyAction({ key: "ArrowDown" }), { type: "step", step: 1 });
  assert.deepEqual(keyAction({ key: "J" }), { type: "step", step: 1 });
  assert.deepEqual(keyAction({ key: "PageUp" }), { type: "step", step: -1 });
  assert.deepEqual(keyAction({ key: " " }), { type: "toggle-play" });
  assert.deepEqual(keyAction({ key: "m" }), { type: "toggle-mute" });
  assert.deepEqual(keyAction({ key: "l" }), { type: "like" });
  assert.deepEqual(keyAction({ key: "c" }), { type: "comments" });
});

test("keys: nothing while typing, with a modifier, or space on a button", () => {
  assert.equal(keyAction({ key: "j", targetTag: "INPUT" }), null);
  assert.equal(keyAction({ key: "ArrowDown", targetTag: "textarea" }), null);
  assert.equal(keyAction({ key: "l", targetEditable: true }), null);
  assert.equal(keyAction({ key: "l", ctrlKey: true }), null);
  assert.equal(keyAction({ key: " ", targetTag: "BUTTON" }), null);
  assert.equal(keyAction({ key: "x" }), null);
});

test("wheel: one flick is one clip", () => {
  assert.equal(wheelStep(100, 1000, 0), 1);
  assert.equal(wheelStep(-100, 1000, 0), -1);
  assert.equal(wheelStep(4, 1000, 0), 0, "a resting finger");
  assert.equal(wheelStep(100, 1000, 1000 - WHEEL_COOLDOWN_MS + 1), 0, "still cooling down");
  assert.equal(wheelStep(100, 1000 + WHEEL_COOLDOWN_MS, 1000), 1);
});

test("swipe: far enough or fast enough, up is next", () => {
  assert.equal(swipeStep(-200, 600, 800), 1, "a slow long drag up");
  assert.equal(swipeStep(200, 600, 800), -1);
  assert.equal(swipeStep(-60, 100, 800), 1, "a short fast flick");
  assert.equal(swipeStep(-60, 600, 800), 0, "short and slow: stays");
  assert.equal(swipeStep(-10, 5, 800), 0, "a tap that wobbled");
});

test("drag: resistance past either end", () => {
  assert.equal(dragOffset(90, 0, 5), 30);
  assert.equal(dragOffset(-90, 4, 5), -30);
  assert.equal(dragOffset(-90, 0, 5), -90);
});

test("slots: play one, preload the next, keep the previous cover, drop the rest", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => slotMode(i, 2)), ["off", "poster", "active", "preload", "off"]);
  assert.equal(clampIndex(9, 3), 2);
  assert.equal(clampIndex(-1, 3), 0);
  assert.equal(clampIndex(5, 0), 0);
});

test("load more a few clips before the end, once", () => {
  assert.ok(shouldLoadMore(4, 8, true, false));
  assert.ok(!shouldLoadMore(2, 8, true, false));
  assert.ok(!shouldLoadMore(7, 8, false, false));
  assert.ok(!shouldLoadMore(7, 8, true, true));
});

test("clips are read field by field", () => {
  const clip = readClip(row(1));
  assert.equal(clip.durationS, 7.5);
  assert.equal(clip.commentCount, 2);
  assert.equal(clip.author.displayName, "mira", "an empty name falls back to the username");
  assert.equal(clip.liked, true);
  assert.equal(clip.saved, true);
  assert.equal(clip.saveCount, 4);
  assert.equal(readClip({ id: "nope" }), null);
  assert.equal(readClip(row(1, { author: null })), null);
  assert.equal(readClips([row(1), "junk", row(2)]).length, 2);
  assert.deepEqual(readClips(null), []);
});

test("sources: the public bucket when there is one, else the media route", () => {
  const clip = readClip(row(1));
  assert.deepEqual(clipSources(clip, "https://media.example.com"), {
    src: `https://media.example.com/hls/${clip.id}/master.m3u8`,
    poster: `https://media.example.com/hls/${clip.id}/thumb-1.webp`,
  });
  assert.deepEqual(clipSources(clip, null), { src: `/api/media/${clip.id}/master.m3u8`, poster: `/api/media/${clip.id}/thumb-1.webp` });
  assert.equal(clipSources(readClip(row(1, { status: "processing", hls_key: null })), null).src, null);
});

test("paging: the cursor is the last clip, and pages never repeat a clip", () => {
  const a = readClips([row(3), row(2)]);
  assert.deepEqual(feedCursor(a), { before: "2026-11-02T10:00:00Z", beforeId: a[1].id });
  assert.equal(feedCursor([]), null);
  assert.deepEqual(mergeClips(a, readClips([row(2), row(1)])).map((c) => c.caption), ["clip 3", "clip 2", "clip 1"]);
});

test("counts, times and lengths", () => {
  assert.deepEqual([0, 999, 1000, 1999, 15300, 3_400_000].map(compactCount), ["0", "999", "1K", "1.9K", "15K", "3.4M"]);
  const now = Date.parse("2026-11-11T12:00:00Z");
  assert.equal(timeAgo("2026-11-11T11:59:40Z", now), "now");
  assert.equal(timeAgo("2026-11-11T09:00:00Z", now), "3h");
  assert.equal(timeAgo("2026-11-01T12:00:00Z", now), "1w");
  assert.equal(timeAgo("2026-03-03T12:00:00Z", now), "Mar 3, 2026");
  assert.equal(timeAgo(null), "");
  assert.equal(clipLength(75.4), "1:15");
});

test("error codes from the database become plain words", () => {
  assert.equal(rpcCode({ message: "comments_off" }), "comments_off");
  assert.equal(rpcCode({ message: "permission denied for function x" }), "error");
  assert.equal(rpcCode(null), null);
  assert.match(socialErrorText("comments_off"), /switched off/);
  assert.equal(socialErrorText("no_db"), "database not connected");
});

import { DOUBLE_TAP_MS, holdAction, isDoubleTap, movedTooFar, readMutedPref, scrubTime } from "../lib/feed/gestures.ts";

test("gestures: a second tap in time is a double tap", () => {
  assert.ok(isDoubleTap(1000 + DOUBLE_TAP_MS, 1000));
  assert.ok(!isDoubleTap(1000 + DOUBLE_TAP_MS + 1, 1000));
  assert.ok(!isDoubleTap(100, 0), "the first tap ever is not a double tap");
});

test("gestures: a finger that moved is a swipe; holding right is 2x, elsewhere pause", () => {
  assert.ok(!movedTooFar(6, 6));
  assert.ok(movedTooFar(0, 11));
  assert.equal(holdAction(100, 390), "pause");
  assert.equal(holdAction(300, 390), "fast");
  assert.equal(holdAction(10, 0), "pause");
});

test("scrub: a point on the bar is a time in the clip, never outside it", () => {
  assert.equal(scrubTime(200, 100, 200, 10), 5);
  assert.equal(scrubTime(0, 100, 200, 10), 0);
  assert.equal(scrubTime(999, 100, 200, 10), 10);
  assert.equal(scrubTime(200, 100, 200, NaN), 0);
});

test("sound: only a remembered 'on' starts with sound", () => {
  assert.equal(readMutedPref("on"), false);
  assert.equal(readMutedPref("off"), true);
  assert.equal(readMutedPref(null), true);
});

import { cleanQuery, cleanTag, readCreators, readDiscover, readSearch, readTagPage, readTags } from "../lib/discover/types.ts";

test("discover: what a person typed, and what an address means", () => {
  assert.equal(cleanQuery("  cats   and\ndogs "), "cats and dogs");
  assert.equal(cleanQuery(["x"]), "");
  assert.equal(cleanQuery("x".repeat(80)).length, 60);
  assert.equal(cleanTag("%23Cats"), "cats");
  assert.equal(cleanTag("so cute"), null);
  assert.equal(cleanTag("x".repeat(31)), null);
});

test("discover: answers are read defensively", () => {
  assert.deepEqual(readTags([{ tag: "cats", clips: "3" }, { tag: "Bad Tag", clips: 1 }, null]), [{ tag: "cats", clips: 3 }]);
  const people = readCreators([{ id: "11111111-2222-4333-8444-555555555555", username: "mira", display_name: "Mira", verified: true, follower_count: 12, video_count: 3 }, { username: "nobody" }]);
  assert.equal(people.length, 1);
  assert.equal(people[0].followerCount, 12);
  assert.equal(readSearch(null), null, "null means the search flag is off");
  assert.deepEqual(readSearch({ q: "x" }), { q: "x", people: [], tags: [], clips: [] });
  assert.equal(readDiscover({ clips: [row(1)] }).clips.length, 1);
  assert.equal(readTagPage({ tag: "cats", clip_count: 2, view_count: "40", videos: [row(1), row(2)] }).viewCount, 40);
  assert.equal(readTagPage({}), null);
});

import { noticeHref, noticeText, readNotices, unreadBadge } from "../lib/social/inbox.ts";

test("inbox: notices are read, worded and linked", () => {
  const actor = { id: "11111111-2222-4333-8444-555555555555", username: "cal", display_name: "Cal" };
  const [like, follow] = readNotices([
    { id: 2, kind: "like", created_at: "2026-11-12T10:00:00Z", unread: true, actor, video: { id: "v1", caption: "hi", thumbnail_url: null }, comment: null },
    { id: 1, kind: "follow", unread: false, actor, video: null },
    { id: 0, kind: "poke", actor },
    { id: 3, kind: "like" },
  ]);
  assert.equal(noticeText(like.kind), "liked your clip");
  assert.equal(noticeHref(like), "/v/v1");
  assert.equal(noticeHref(follow), "/@cal");
  assert.equal(like.unread, true);
  assert.equal(readNotices([{ kind: "like", actor }, null]).length, 1);
  assert.deepEqual([0, 3, 9, 10, 250].map(unreadBadge), [null, "3", "9", "9+", "9+"]);
});

import { mergeMessages, previewText, readMessage, readThread, readThreads } from "../lib/social/messages.ts";

test("messages: read, previewed and merged without repeats", () => {
  const person = { id: "11111111-2222-4333-8444-555555555555", username: "mira", display_name: "Mira" };
  const m = (id, body, mine = false, extra = {}) => ({ id, body, created_at: "2026-11-12T10:00:00Z", mine, ...extra });
  assert.equal(readMessage({ id: 1 }), null);
  assert.equal(previewText(readMessage(m(1, "hi"))), "hi");
  assert.equal(previewText(readMessage(m(2, "", true, { had_video: true }))), "You: Sent a clip");
  assert.equal(readThreads([{ with: person, last: m(3, "yo"), unread: "2" }, { with: null, last: m(4, "x") }])[0].unread, 2);
  assert.equal(readThread({ with: person, messages: [m(1, "a"), "junk", m(2, "b")] }).messages.length, 2);
  assert.equal(readThread({ messages: [] }), null);
  const have = [readMessage(m(1, "a")), { ...readMessage(m(-5, "new one", true)), pending: true }];
  const merged = mergeMessages(have, [readMessage(m(1, "a")), readMessage(m(2, "new one", true))]);
  assert.deepEqual(merged.map((x) => x.id), [1, 2], "the pending copy goes once the saved one arrives");
});
