#!/usr/bin/env node
// Smoke test: asks a running copy of YapTok for its main pages and checks the
// answers. No browser, only fetch.
//
//   npm run build && npx next start -p 3123 &
//   node scripts/smoke.mjs http://localhost:3123
//
// It works out by itself which of the two modes the site is in:
//   - "database not connected" (no Supabase settings): every page must still
//     answer and say so, /admin must be hidden, the API must refuse politely
//   - connected (for example to scripts/local-stack.mjs --seed): the feed is
//     there, creator pages work, /admin is still a 404 for a visitor
// Exits 1 when any check fails.

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
const UUID = "00000000-0000-4000-8000-000000000000";
let failed = 0;
let passed = 0;

function check(name, ok, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `  (${detail})`}`);
}

async function get(path, init) {
  const res = await fetch(base + path, { redirect: "manual", ...init });
  const text = await res.text();
  return { status: res.status, text, headers: res.headers, json: () => JSON.parse(text) };
}

const home = await get("/").catch((err) => {
  console.error(`Could not reach ${base}: ${err.message}`);
  process.exit(1);
});
const noDb = home.text.includes('data-feed-empty="no-db"');
console.log(`${base}: ${noDb ? "database not connected" : "connected to a database"}\n`);

check("/ answers 200", home.status === 200, `status ${home.status}`);
check("/ carries the name and the mark", home.text.includes("YapTok") && home.text.includes("<title>YapTok</title>"));
check("/ sets the theme before first paint", home.text.includes("yaptok-theme"));
check("/ has the navigation", home.text.includes("data-bottom-bar") && home.text.includes("data-side-rail"));

if (noDb) {
  check("/ says database not connected", home.text.includes("database not connected"));
  for (const path of ["/login", "/signup", "/settings", "/upload", "/@someone"]) {
    const page = await get(path);
    check(`${path} answers 200 and says database not connected`, page.status === 200 && page.text.includes("database not connected"), `status ${page.status}`);
  }
  const upload = await get("/upload");
  check("/upload still shows the form as a preview", upload.text.includes("data-upload-pick") && /Up to (<!-- -->)?60(<!-- -->)? seconds/.test(upload.text) && upload.text.includes("data-upload-blocked"));
  const clip = await get(`/v/${UUID}`);
  check("/v/<id> answers 200 with the notice", clip.status === 200 && clip.text.includes("database not connected"), `status ${clip.status}`);
  const sign = await get("/api/upload/sign", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  check("POST /api/upload/sign refuses with JSON", [501, 503].includes(sign.status) && typeof sign.json().error === "string", `status ${sign.status}`);
  const media = await get(`/api/media/${UUID}/master.m3u8`);
  check("/api/media refuses with no_db", media.status === 503 && media.json().error === "no_db", `status ${media.status}`);
  const status = await get(`/api/videos/${UUID}/status`);
  check("/api/videos/<id>/status refuses with no_db", status.status === 503 && status.json().error === "no_db", `status ${status.status}`);
} else {
  const hasFeed = home.text.includes("data-feed=") || home.text.includes("data-feed ");
  const empty = home.text.includes("data-feed-empty=");
  check("/ shows the feed or a clear empty state", hasFeed || empty);
  for (const path of ["/login", "/signup"]) {
    const page = await get(path);
    check(`${path} answers 200`, page.status === 200, `status ${page.status}`);
  }
  const upload = await get("/upload");
  check("/upload sends a visitor to sign in (or says uploads are off)", [200, 307].includes(upload.status), `status ${upload.status}`);
  // These pages stream: the status line has left before the database answers,
  // so "not found" shows as the not found page (with noindex), not as a 404 status.
  const missing = await get("/@nobody_by_this_name");
  check("/@<unknown> shows the not found page", missing.text.includes("This page isn") && !missing.text.includes("data-profile="), `status ${missing.status}`);
  const gone = await get(`/v/${UUID}`);
  check("/v/<unknown id> shows the not found page", gone.text.includes("This page isn") && !gone.text.includes("data-clip="), `status ${gone.status}`);
  const sign = await get("/api/upload/sign", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  check("POST /api/upload/sign refuses a visitor", [401, 403, 501].includes(sign.status), `status ${sign.status}`);
  const media = await get(`/api/media/${UUID}/master.m3u8`);
  check("/api/media is a 404 for an unknown clip", [403, 404].includes(media.status), `status ${media.status}`);
}

for (const path of ["/admin", "/admin/settings", "/admin/reports", "/admin/videos", "/admin/accounts", "/admin/log", "/admin/stats"]) {
  const page = await get(path);
  check(`${path} is a plain 404 for a visitor`, page.status === 404 && !page.text.includes("data-admin="), `status ${page.status}`);
}

const nowhere = await get("/this-page-does-not-exist");
check("an unknown page is a 404 with the way back", nowhere.status === 404 && nowhere.text.includes("Back home"), `status ${nowhere.status}`);
const health = await get("/api/health");
check("/api/health answers 200", health.status === 200, `status ${health.status}`);
const version = await get("/api/version");
check("/api/version answers 200 with JSON", version.status === 200 && typeof version.json() === "object", `status ${version.status}`);
const icon = await get("/favicon.ico");
check("/favicon.ico is served", icon.status === 200, `status ${icon.status}`);

// Nothing in any page may carry a secret looking setting name with a value.
check("no server only setting names in the home page", !/SERVICE_ROLE|R2_SECRET|R2_ACCESS_KEY/.test(home.text));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
