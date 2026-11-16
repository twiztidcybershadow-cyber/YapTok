// Checks that keep the repository ready to be public: the migrations run in a
// clean order, the secret scan catches keys, and .env.example names every
// setting the code reads.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { migrationFiles } from "../scripts/db-migrations.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);

test("migrations are numbered 000, 001, ... with no gaps or doubles", () => {
  const files = migrationFiles();
  assert.ok(files.length >= 10);
  files.forEach((f, i) => assert.equal(f.slice(0, 3), String(i).padStart(3, "0"), `${f} is out of order`));
});

test("db-migrations bundles every file in order", () => {
  const res = spawnSync(process.execPath, [join(root, "scripts/db-migrations.mjs")], { encoding: "utf8", maxBuffer: 1 << 26 });
  assert.equal(res.status, 0);
  const headers = [...res.stdout.matchAll(/^-- ===== (\S+) =====$/gm)].map((m) => m[1]);
  assert.deepEqual(headers, migrationFiles());
});

test("supabase/yaptok-all-migrations.sql is in step with the migration files", () => {
  const res = spawnSync(process.execPath, [join(root, "scripts/db-migrations.mjs")], { encoding: "utf8", maxBuffer: 1 << 26 });
  const kept = readFileSync(join(root, "supabase/yaptok-all-migrations.sql"), "utf8");
  assert.equal(kept, res.stdout, "run: npm run -s db:migrations > supabase/yaptok-all-migrations.sql");
});

function scan(files) {
  const dir = mkdtempSync(join(tmpdir(), "secrets-"));
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    return spawnSync(process.execPath, [join(root, "scripts/check-secrets.mjs")], { cwd: dir, encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("check-secrets passes placeholders and made up data", () => {
  const res = scan({
    "ok.txt": [
      "R2_SECRET_ACCESS_KEY=",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_replace_me",
      "write to sam@example.com or noreply@anthropic.com",
      "listen on 127.0.0.1 and 10.0.0.5",
      'const SERVICE_KEY_ENV = "SUPABASE_SERVICE_ROLE_KEY";',
    ].join("\n"),
  });
  assert.equal(res.status, 0, res.stderr);
});

test("check-secrets catches keys, real addresses and public IPs", () => {
  const hex64 = "0123456789abcdef".repeat(4);
  const cases = {
    "r2.txt": `R2_SECRET_ACCESS_KEY=${hex64}`,
    "sb.txt": "key: " + "sb_" + "secret_abcdefghijklmnop",
    "jwt.txt": "eyJ" + "hbGciOiJIUzI1NiJ9.e30.x",
    "gh.txt": "token " + "gh" + "p_" + "a".repeat(36),
    "mail.txt": "ask " + "someone" + "@" + "gmail.com",
    "ip.txt": "ssh root@" + ["5", "75", "1", "9"].join("."),
  };
  for (const [name, text] of Object.entries(cases)) {
    const res = scan({ [name]: text });
    assert.equal(res.status, 1, `${name} was not caught`);
  }
});

test(".env.example names every setting the app reads", () => {
  const example = readFileSync(join(root, ".env.example"), "utf8");
  for (const name of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
    "MEDIA_PUBLIC_URL",
  ]) {
    assert.match(example, new RegExp(`^${name}=`, "m"), `${name} is missing from .env.example`);
  }
  assert.doesNotMatch(example, /\.supabase\.co/, "no real project URL in .env.example");
});

test("worker/.env.example names every setting the worker reads", () => {
  const example = readFileSync(join(root, "worker/.env.example"), "utf8");
  const env = readFileSync(join(root, "worker/lib/env.mjs"), "utf8");
  const names = new Set([...env.matchAll(/"([A-Z][A-Z0-9_]{3,})"/g)].map((m) => m[1]));
  for (const name of names) assert.match(example, new RegExp(`^${name}=`, "m"), `${name} is missing from worker/.env.example`);
});

/** Every text file in the repository that people read or that ships. */
function repoFiles() {
  const res = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
  return res.stdout.split("\n").filter((f) => /\.(ts|tsx|mjs|md|sql|css|yml|sh|json|example)$/.test(f) && !f.endsWith("package-lock.json") && existsSync(join(root, f)));
}

test("no em dashes anywhere, and nobody else's product names", () => {
  const dash = String.fromCharCode(0x2014);
  // Built from pieces so this file does not match itself.
  const names = new RegExp(["tik" + "tok", "you" + "tube", "insta" + "gram", "snap" + "chat", "slop" + "tube", "sn" + "ips\\b"].join("|"), "i");
  for (const file of repoFiles()) {
    const text = readFileSync(join(root, file), "utf8");
    // AGENTS.md is written by `next dev`, word for word; the rest is ours.
    if (file === "AGENTS.md") continue;
    assert.ok(!text.includes(dash), `${file} has an em dash`);
    // The notice, the README and CLAUDE.md credit the project YapTok started from.
    if (["AGENTS.md", "NOTICE.md", "README.md", "CLAUDE.md"].includes(file)) continue;
    const hit = names.exec(text);
    assert.equal(hit, null, `${file} names another product: ${hit?.[0]}`);
  }
});

test("the brand is ours: one mark, drawn in lib/brand.ts", async () => {
  const brand = await import("../lib/brand.ts");
  assert.equal(brand.SITE_NAME, "YapTok");
  assert.match(brand.markSvg(), /^<svg [^>]*viewBox="0 0 24 24"/);
  assert.ok(brand.markSvg().includes(brand.MARK_HEAD) && brand.markSvg().includes(brand.MARK_STEM));
  assert.match(brand.logoSvg(), /Yap<\/tspan><tspan[^>]*>Tok/);
  const css = readFileSync(join(root, "app/globals.css"), "utf8");
  assert.ok(css.includes(brand.BRAND.orange), "globals.css uses the brand orange");
  assert.ok(css.includes(brand.BRAND.orangeDeep), "and the darker orange that buttons use");
});

test("the Supabase settings are never read in a way the build can freeze", () => {
  const src = readFileSync(join(root, "lib/supabase/env.ts"), "utf8");
  assert.match(src, /Reflect\.get\(process\.env, name\)/);
  assert.doesNotMatch(src, /process\.env\.NEXT_PUBLIC|env\[SUPABASE_/);
  // Nothing else in the app reads them directly.
  for (const file of repoFiles().filter((f) => /^(app|components|lib)\//.test(f) && f !== "lib/supabase/env.ts")) {
    assert.doesNotMatch(readFileSync(join(root, file), "utf8"), /process\.env\.NEXT_PUBLIC_SUPABASE|env\["NEXT_PUBLIC_SUPABASE/, file);
  }
});
