// The upload rules the page, the routes and the database share.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cleanCoverAt,
  cleanHashtags,
  fileProblemCode,
  formatBytes,
  keyBelongsTo,
  parseHashtags,
  percentDone,
  planParts,
  sourceKey,
  uploadErrorText,
  videoTypeFor,
} from "../lib/upload/rules.ts";

const MB = 1024 * 1024;
const limits = { maxBytes: 200 * MB, maxSeconds: 60 };

test("video types: by type, by extension, and recordings with codecs", () => {
  assert.equal(videoTypeFor({ name: "a.mp4", type: "video/mp4" }), "video/mp4");
  assert.equal(videoTypeFor({ name: "a.mkv", type: "" }), "video/x-matroska");
  assert.equal(videoTypeFor({ name: "recording.webm", type: "video/webm;codecs=vp9,opus" }), "video/webm");
  assert.equal(videoTypeFor({ name: "a.png", type: "image/png" }), null);
  assert.equal(videoTypeFor({ name: "mp4", type: "" }), null);
});

test("file problems follow the owner's limits", () => {
  const file = { name: "a.mp4", type: "video/mp4", size: 10 * MB };
  assert.equal(fileProblemCode(file, limits), null);
  assert.equal(fileProblemCode({ ...file, size: 0 }, limits), "file_empty");
  assert.equal(fileProblemCode({ ...file, size: 201 * MB }, limits), "file_too_big");
  assert.equal(fileProblemCode(file, { ...limits, maxBytes: 5 * MB }), "file_too_big");
  assert.equal(fileProblemCode(file, limits, 60.8), null, "one second of slack");
  assert.equal(fileProblemCode(file, limits, 61.5), "too_long");
  assert.equal(fileProblemCode(file, limits, Infinity), null, "an unknown length is left to the encoder");
});

test("hashtags are cleaned like clean_hashtags() in the database", () => {
  assert.deepEqual(cleanHashtags(["#Cats", "cats", "so cute", "fun_1", 7, "##deep"]), ["cats", "fun_1", "deep"]);
  assert.deepEqual(parseHashtags("#cats, Dogs  #so_cute\n#cats"), ["cats", "dogs", "so_cute"]);
  assert.equal(parseHashtags("a b c d e f g h i j").length, 8);
  assert.deepEqual(parseHashtags("   "), []);
  assert.deepEqual(parseHashtags("x".repeat(31)), []);
});

test("the cover frame stays inside the clip", () => {
  assert.equal(cleanCoverAt(2.456, 10), 2.46);
  assert.equal(cleanCoverAt(25, 10), 10);
  assert.equal(cleanCoverAt(-1, 10), null);
  assert.equal(cleanCoverAt("3", 10), null);
  assert.equal(cleanCoverAt(3, null), 3);
});

test("parts and keys", () => {
  assert.equal(planParts(40 * MB).length, 3);
  assert.deepEqual(planParts(0), []);
  const owner = "11111111-2222-3333-4444-555555555555";
  const key = sourceKey(owner, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "video/mp4");
  assert.equal(key, `uploads/${owner}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/source.mp4`);
  assert.ok(keyBelongsTo(key, owner));
  assert.ok(!keyBelongsTo(key, "99999999-8888-7777-6666-555555555555"));
  assert.ok(!keyBelongsTo("uploads/../x", owner));
});

test("progress and error text", () => {
  assert.equal(percentDone(99, 100), 99);
  assert.equal(percentDone(100, 100), 100);
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.match(uploadErrorText("file_too_big", limits), /200 MB/);
  assert.match(uploadErrorText("too_long", { ...limits, maxSeconds: 90 }), /90 seconds/);
  assert.equal(uploadErrorText("no_db"), "database not connected");
  assert.equal(uploadErrorText("whatever"), "Something went wrong. Try again.");
});
