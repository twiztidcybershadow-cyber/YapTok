// What the admin panel reads and how it words things: lib/admin/types.ts,
// lib/site/settings-core.ts and the preview rows.
import assert from "node:assert/strict";
import { test } from "node:test";
import { previewFlags, previewLog, previewSettings, previewStats } from "../lib/admin/preview.ts";
import { adminErrorText, dayLabel, filterFlags, logText, modeHint, niceMax, readFlags, readLog, readSettingRows, readStats, settingValueText } from "../lib/admin/types.ts";
import { DEFAULT_SETTINGS, readSettings, uploadWhoText } from "../lib/site/settings-core.ts";
import { REPORT_REASONS, isReportReason, reasonLabel } from "../lib/social/reports.ts";

test("flag search matches key, name and description, every word", () => {
  assert.deepEqual(filterFlags(previewFlags, "comment").map((f) => f.key), ["comments"]);
  assert.deepEqual(filterFlags(previewFlags, "CLIP heart").map((f) => f.key), ["likes"]);
  assert.equal(filterFlags(previewFlags, "  ").length, previewFlags.length);
  assert.deepEqual(filterFlags(previewFlags, "zzz"), []);
});

test("flags are read defensively", () => {
  const flags = readFlags([
    { key: "feed", label: "", description: "d", mode: "test", testers: 2, me_listed: true, updated_at: "2026-11-11T00:00:00Z", updated_by: { id: "x", username: "owner" } },
    { key: "bad", mode: "sometimes" },
    "junk",
  ]);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].label, "feed");
  assert.equal(flags[0].updatedBy.username, "owner");
  assert.deepEqual(readFlags(null), []);
});

test("who sees a flag, in words", () => {
  assert.equal(modeHint({ mode: "everyone", testers: 0, meListed: false }), "On for everyone");
  assert.equal(modeHint({ mode: "off", testers: 3, meListed: true }), "Off for everyone");
  assert.equal(modeHint({ mode: "test", testers: 1, meListed: true }), "On for you only");
  assert.equal(modeHint({ mode: "test", testers: 3, meListed: true }), "On for you and 2 more testers");
  assert.match(modeHint({ mode: "test", testers: 1, meListed: false }), /1 tester, not you/);
});

test("settings rows and their typed form", () => {
  const rows = readSettingRows([{ key: "upload_max_seconds", label: "Longest clip", kind: "number", value: 90, min: 3, max: 600 }, { key: "x", kind: "weird" }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value, 90);
  const s = readSettings([
    { key: "upload_max_seconds", value: 90 },
    { key: "upload_max_mb", value: "lots" },
    { key: "upload_who", value: "invite" },
    { key: "comments_enabled", value: false },
    { key: "maintenance_banner", value: "  Back soon  " },
  ]);
  assert.equal(s.uploadMaxSeconds, 90);
  assert.equal(s.uploadMaxMb, DEFAULT_SETTINGS.uploadMaxMb, "a bad value falls back");
  assert.equal(s.uploadWho, "invite");
  assert.equal(s.commentsEnabled, false);
  assert.equal(s.signupsOpen, true);
  assert.equal(s.banner, "Back soon");
  assert.deepEqual(readSettings(null), DEFAULT_SETTINGS);
  assert.equal(uploadWhoText("verified"), "Verified accounts only");
  assert.equal(previewSettings.length, 6);
});

test("the audit log reads as sentences", () => {
  const [setting, flag] = previewLog;
  assert.equal(logText(flag), "switched the likes flag from test to everyone");
  assert.equal(logText(setting), 'changed upload_who from "verified" to "everyone"');
  assert.equal(logText({ action: "account.ban", targetId: "id", targetName: "@sam", details: { reason: "spam" } }), "banned @sam (spam)");
  assert.equal(logText({ action: "setting.set", targetId: "signups_open", targetName: null, details: { from: true, to: false } }), "changed signups_open from open to closed");
  assert.equal(logText({ action: "account.verified", targetId: "id", targetName: "@mira", details: { on: false } }), "took the verified mark from @mira");
  assert.equal(settingValueText("maintenance_banner", ""), "(empty)");
  assert.equal(readLog([{ id: 3, action: "x", details: null }, {}]).length, 1);
});

test("stats: read, scaled and labelled", () => {
  const s = readStats({ days: [{ day: "2026-11-11", signups: 2, uploads: "1", views: 40 }, { day: "soon" }], totals: { accounts: 5, open_reports: 2 } });
  assert.deepEqual(s.days, [{ day: "2026-11-11", signups: 2, uploads: 1, views: 40 }]);
  assert.equal(s.totals.openReports, 2);
  assert.equal(s.totals.clips, 0);
  assert.deepEqual([0, 3, 5, 7, 12, 423, 1000].map((v) => niceMax([v])), [4, 4, 5, 10, 20, 500, 1000]);
  assert.equal(dayLabel("2026-11-05"), "Nov 5");
  assert.equal(previewStats.days.length, 14);
});

test("admin errors and report reasons have words", () => {
  assert.equal(adminErrorText("not_admin"), "Only admins can do that.");
  assert.match(adminErrorText("locked"), /cannot be switched off/);
  assert.equal(adminErrorText("???"), "Something went wrong. Try again.");
  assert.equal(REPORT_REASONS.length, 9);
  assert.ok(isReportReason("spam") && !isReportReason("boring"));
  assert.equal(reasonLabel("minor_safety"), "A child may be at risk");
});
