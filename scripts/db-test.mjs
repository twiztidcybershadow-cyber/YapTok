#!/usr/bin/env node
// Runs the SQL tests in supabase/tests against a real PostgreSQL.
//
//   node scripts/db-test.mjs
//
// Needs PostgreSQL 15 or newer and DATABASE_URL pointing at it as a superuser
// (default postgresql://postgres@127.0.0.1:5432/postgres). It makes a
// throwaway database, runs the shim (what a Supabase project already has),
// runs every migration TWICE (they must be safe to run again), runs the
// tests as the three API roles and drops the database again.

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { migrationFiles } from "./db-migrations.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const admin = process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/postgres";
const name = `yaptok_test_${process.pid}`;
const url = (() => {
  const u = new URL(admin);
  u.pathname = `/${name}`;
  return u.toString();
})();

function psql(target, args, { capture = false } = {}) {
  const res = spawnSync("psql", [target, "-v", "ON_ERROR_STOP=1", "-q", ...args], { encoding: "utf8", maxBuffer: 1 << 26 });
  if (res.error) {
    console.error(`psql could not start (${res.error.message}). Install the PostgreSQL client.`);
    process.exit(2);
  }
  if (!capture && res.status !== 0) process.stderr.write(res.stderr);
  return res;
}

let failed = false;
if (psql(admin, ["-c", `create database ${name}`]).status !== 0) process.exit(2);
try {
  const step = (label, res) => {
    if (res.status !== 0) {
      failed = true;
      throw new Error(label);
    }
  };
  step("shim", psql(url, ["-f", join(root, "supabase/tests/shim.sql")]));
  const dir = join(root, "supabase/migrations");
  for (const round of ["first run", "second run"]) {
    for (const f of migrationFiles()) step(`${f} (${round})`, psql(url, ["-c", "set client_min_messages = warning", "-f", join(dir, f)]));
    console.log(`migrations, ${round}: ${migrationFiles().length} files applied`);
  }
  for (const f of readdirSync(join(root, "supabase/tests")).filter((x) => x.endsWith(".test.sql")).sort()) {
    const res = psql(url, ["-f", join(root, "supabase/tests", f)], { capture: true });
    const passed = (res.stderr.match(/NOTICE: {2}ok - /g) ?? []).length;
    if (res.status !== 0 || !res.stdout.includes("ALL PASSED")) {
      failed = true;
      console.error(res.stderr.split("\n").filter((l) => /ERROR|FAILED/.test(l)).join("\n"));
      console.error(`${f}: FAILED after ${passed} passing checks`);
    } else {
      console.log(`${f}: ${passed} checks passed`);
    }
  }
} catch (err) {
  console.error(`stopped at: ${err.message}`);
} finally {
  psql(admin, ["-c", `drop database if exists ${name} with (force)`]);
}
process.exit(failed ? 1 : 0);
