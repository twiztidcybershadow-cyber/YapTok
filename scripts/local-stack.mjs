#!/usr/bin/env node
// A local stand in for Supabase and R2, for development, the screenshots and
// the end to end checks. It is NOT Supabase: it is one small server that
// speaks just enough of the same HTTP for this app, on top of a real local
// PostgreSQL that has the real migrations applied. Row level security, the
// roles and every database function behave as they will on Supabase, because
// they are the same SQL running as the same roles.
//
//   node scripts/local-stack.mjs --reset --seed
//
// Needs PostgreSQL 15 or newer running locally and DATABASE_URL pointing at
// it as a superuser (default postgresql://postgres@127.0.0.1:5432/postgres),
// and ffmpeg for --seed. It prints the settings to put in .env.local (and in
// the worker's env file) and then serves until Ctrl+C:
//
//   /auth/v1/*   sign up, sign in with a password, refresh, the current user
//   /rest/v1/*   table reads with simple filters, profile updates, and
//                /rest/v1/rpc/<function> for every database function
//   /s3/*        an S3 stand in for uploads (multipart), the worker and the
//                media route, files kept in a temp folder
//   /media/*     the same files, public, as MEDIA_PUBLIC_URL
//
//   --reset   drop and recreate the yaptok_local database, run the shim and
//             every migration
//   --seed    made up accounts and test pattern clips (see local-seed.mjs)
//   --port N  the port to listen on (default 54321)
//   --host A  this computer's address on your Wi-Fi, like 192.168.1.20, to open
//             the demo on a phone on the same network. The stack then listens
//             on every interface, so only use it on a network you trust.
//             Start the app with `npx next start -H 0.0.0.0` and open
//             http://A:3000 on the phone. Plain http: the feed and the admin
//             panel work, the camera and "copy link" need https.
//
// Everything it makes is made up. Never point it at a real database.

import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { migrationFiles } from "./db-migrations.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);

const PORT = Number(option("--port", process.env.STACK_PORT ?? 54321));
const ADMIN_URL = process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/postgres";
const DB_NAME = "yaptok_local";
const HOST = option("--host", process.env.STACK_HOST ?? "127.0.0.1");
if (!/^[a-z0-9.-]+$/i.test(HOST)) {
  console.error("--host takes an address like 192.168.1.20");
  process.exit(2);
}
const BASE = `http://${HOST}:${PORT}`;
export const DATA_DIR = resolve(process.env.STACK_DATA_DIR ?? join(tmpdir(), "yaptok-local-stack"));
const BUCKET = "yaptok-local";
// A fixed, public, local only signing secret: these tokens mean nothing anywhere else.
const JWT_SECRET = "yaptok-local-stack-not-a-secret";

const dbUrl = (() => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${DB_NAME}`;
  return u.toString();
})();

// Tokens ------------------------------------------------------------------------------

const b64 = (buf) => Buffer.from(buf).toString("base64url");
function sign(claims, ttlS) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64(JSON.stringify({ iss: "yaptok-local", iat: now, exp: now + ttlS, ...claims }));
  return `${head}.${body}.${b64(createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest())}`;
}
function verify(token) {
  const [head, body, sig] = String(token ?? "").split(".");
  if (!head || !body || !sig) return null;
  const want = createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString());
    return claims.exp > Date.now() / 1000 ? claims : null;
  } catch {
    return null;
  }
}
const TEN_YEARS = 10 * 365 * 86400;
export const ANON_KEY = sign({ role: "anon" }, TEN_YEARS);
export const SERVICE_KEY = sign({ role: "service_role" }, TEN_YEARS);

export function hashPassword(password) {
  const salt = randomBytes(12).toString("hex");
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
}
function passwordOk(password, stored) {
  const [salt, hash] = String(stored ?? "").split(":");
  if (!salt || !hash) return false;
  const got = scryptSync(password, salt, 32);
  const want = Buffer.from(hash, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

// Database ----------------------------------------------------------------------------

function psql(url, args) {
  const res = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", ...args], { stdio: ["ignore", "ignore", "inherit"] });
  if (res.error) throw new Error(`psql could not start: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`psql failed: ${args.join(" ")}`);
}

export function resetDatabase() {
  psql(ADMIN_URL, ["-c", `drop database if exists ${DB_NAME} with (force)`, "-c", `create database ${DB_NAME}`]);
  psql(dbUrl, ["-f", join(root, "supabase/tests/shim.sql")]);
  const dir = join(root, "supabase/migrations");
  for (const f of migrationFiles()) psql(dbUrl, ["-c", "set client_min_messages = warning", "-f", join(dir, f)]);
}

const pool = new pg.Pool({ connectionString: dbUrl, max: 8 });
export const adminQuery = (text, params) => pool.query(text, params);

class ApiError extends Error {
  constructor(status, body) {
    super(body.message ?? "error");
    this.status = status;
    this.body = body;
  }
}

/** Runs fn inside a transaction as the API role of this request, with its JWT claims set, like the real API does. */
async function asRole(claims, fn) {
  const role = ["anon", "authenticated", "service_role"].includes(claims?.role) ? claims.role : "anon";
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims ?? {})]);
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    if (err instanceof ApiError) throw err;
    // The same shape PostgREST answers with: the message is what the app reads.
    const status = err.code === "42501" ? (role === "anon" ? 401 : 403) : err.code === "P0001" || err.code?.startsWith("2") ? 400 : 500;
    throw new ApiError(status, { code: err.code ?? "XX000", message: err.message, details: err.detail ?? null, hint: err.hint ?? null });
  } finally {
    client.release();
  }
}

const ident = (name) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new ApiError(400, { code: "PGRST100", message: `bad name: ${name}` });
  return `"${name}"`;
};

/** The arguments of a public function, by name: [{ name, type }] per overload. */
const signatures = new Map();
async function signatureOf(fn) {
  if (!signatures.has(fn)) {
    const { rows } = await pool.query(
      `select p.proargnames as names, p.pronargs as n, p.proretset as is_set, t.typtype as ret_kind, t.typname as ret_name,
              (select array_agg(format_type(a, null) order by o) from unnest(p.proargtypes) with ordinality as x(a, o)) as types
         from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
        where ns.nspname = 'public' and p.proname = $1`,
      [fn],
    );
    signatures.set(fn, rows);
  }
  return signatures.get(fn);
}

/** POST /rest/v1/rpc/<fn>: named arguments from the JSON body, cast to the function's own types. */
async function rpc(fn, body, claims, wantObject) {
  ident(fn);
  const given = Object.keys(body ?? {});
  const sig = (await signatureOf(fn)).find((s) => given.every((k) => (s.names ?? []).slice(0, s.n).includes(k)));
  if (!sig) throw new ApiError(404, { code: "PGRST202", message: `Could not find the function public.${fn}(${given.join(", ")}) in the schema cache` });
  const names = (sig.names ?? []).slice(0, sig.n);
  const args = given.map((k) => {
    const type = sig.types[names.indexOf(k)];
    const path = `$1::jsonb -> '${k}'`;
    if (type === "json" || type === "jsonb") return `${ident(k)} := (${path})::${type}`;
    if (type.endsWith("[]")) return `${ident(k)} := case when jsonb_typeof(${path}) = 'array' then array(select jsonb_array_elements_text(${path}))::${type} end`;
    return `${ident(k)} := ($1::jsonb ->> '${k}')::${type}`;
  });
  const call = `public.${ident(fn)}(${args.join(", ")})`;
  const rowsLike = sig.is_set || sig.ret_kind === "c";
  const text = rowsLike ? `select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) as out from ${call} r` : sig.ret_name === "void" ? `select ${call}, null::jsonb as out` : `select to_jsonb(${call}) as out`;
  // A function without arguments has no $1 to bind.
  const params = args.length ? [JSON.stringify(body)] : [];
  const out = await asRole(claims, async (c) => (await c.query(text, params)).rows[0]?.out ?? null);
  if (rowsLike && wantObject) {
    if (!Array.isArray(out) || out.length !== 1) throw new ApiError(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
    return out[0];
  }
  return out;
}

/** col=eq.x, col=in.(a,b), col=is.null: the filters this app uses. */
function whereOf(params, values) {
  const parts = [];
  for (const [key, raw] of params) {
    if (["select", "order", "limit", "offset"].includes(key)) continue;
    const dot = raw.indexOf(".");
    const op = raw.slice(0, dot);
    const value = raw.slice(dot + 1);
    if (op === "eq") parts.push(`${ident(key)}::text = $${values.push(value)}`);
    else if (op === "in") parts.push(`${ident(key)}::text = any($${values.push(value.replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, "")))})`);
    else if (op === "is" && value === "null") parts.push(`${ident(key)} is null`);
    else throw new ApiError(400, { code: "PGRST100", message: `the local stack does not know the filter ${op}` });
  }
  return parts.length ? ` where ${parts.join(" and ")}` : "";
}

async function tableRead(table, params, claims, wantObject) {
  const select = params.get("select") ?? "*";
  const cols = select === "*" ? "*" : select.split(",").map((c) => ident(c.trim())).join(", ");
  const values = [];
  let text = `select ${cols} from public.${ident(table)}${whereOf(params, values)}`;
  const order = params.get("order");
  if (order) {
    text += ` order by ${order.split(",").map((o) => {
      const [col, dir] = o.split(".");
      return `${ident(col)} ${dir === "desc" ? "desc" : "asc"}`;
    }).join(", ")}`;
  }
  const limit = Number(params.get("limit"));
  if (Number.isInteger(limit) && limit > 0) text += ` limit ${limit}`;
  const rows = await asRole(claims, async (c) => (await c.query(`select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as out from (${text}) t`, values)).rows[0].out);
  if (wantObject) {
    if (rows.length !== 1) throw new ApiError(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
    return rows[0];
  }
  return rows;
}

async function tableUpdate(table, params, body, claims) {
  const keys = Object.keys(body ?? {});
  if (keys.length === 0) return null;
  const values = keys.map((k) => body[k]);
  const sets = keys.map((k, i) => `${ident(k)} = $${i + 1}`).join(", ");
  await asRole(claims, (c) => c.query(`update public.${ident(table)} set ${sets}${whereOf(params, values)}`, values));
  return null;
}

// Auth --------------------------------------------------------------------------------

function userJson(row) {
  return {
    id: row.id,
    aud: "authenticated",
    role: "authenticated",
    email: row.email,
    email_confirmed_at: row.created_at,
    confirmed_at: row.created_at,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: row.raw_user_meta_data ?? {},
    identities: [],
    created_at: row.created_at,
    updated_at: row.created_at,
  };
}

function session(row) {
  const expires_in = 3600;
  return {
    access_token: sign({ sub: row.id, role: "authenticated", aud: "authenticated", email: row.email, session_id: randomUUID() }, expires_in),
    token_type: "bearer",
    expires_in,
    expires_at: Math.floor(Date.now() / 1000) + expires_in,
    refresh_token: sign({ sub: row.id, use: "refresh" }, 30 * 86400),
    user: userJson(row),
  };
}

async function auth(path, url, method, body, bearer) {
  if (path === "/signup" && method === "POST") {
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    if (!/^[^@\s]+@[^@\s]+$/.test(email) || password.length < 6) throw new ApiError(422, { code: "validation_failed", msg: "A valid email and a password of 6 or more characters are needed", message: "invalid signup" });
    try {
      const { rows } = await pool.query("insert into auth.users (email, password_hash, raw_user_meta_data) values ($1, $2, $3) returning *", [email, hashPassword(password), JSON.stringify(body?.data ?? {})]);
      return session(rows[0]);
    } catch (err) {
      if (err.code === "23505") throw new ApiError(422, { code: "user_already_exists", msg: "User already registered", message: "User already registered" });
      // The signup trigger said no (sign-ups closed, too young): the real auth server answers like this.
      throw new ApiError(500, { code: "unexpected_failure", msg: "Database error saving new user", message: "Database error saving new user" });
    }
  }
  if (path === "/token" && method === "POST") {
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      const { rows } = await pool.query("select * from auth.users where email = $1", [String(body?.email ?? "").trim().toLowerCase()]);
      if (!rows[0] || !passwordOk(String(body?.password ?? ""), rows[0].password_hash)) {
        throw new ApiError(400, { code: "invalid_credentials", error_code: "invalid_credentials", msg: "Invalid login credentials", message: "Invalid login credentials" });
      }
      return session(rows[0]);
    }
    if (grant === "refresh_token") {
      const claims = verify(body?.refresh_token);
      const { rows } = claims?.use === "refresh" ? await pool.query("select * from auth.users where id = $1", [claims.sub]) : { rows: [] };
      if (!rows[0]) throw new ApiError(400, { code: "refresh_token_not_found", msg: "Invalid Refresh Token", message: "Invalid Refresh Token" });
      return session(rows[0]);
    }
  }
  if (path === "/user" && method === "GET") {
    const claims = verify(bearer);
    const { rows } = claims?.sub ? await pool.query("select * from auth.users where id = $1", [claims.sub]) : { rows: [] };
    if (!rows[0]) throw new ApiError(401, { code: "bad_jwt", msg: "invalid JWT", message: "invalid JWT" });
    return userJson(rows[0]);
  }
  if (path === "/logout" && method === "POST") return null;
  throw new ApiError(404, { code: "not_found", message: `the local stack has no auth route ${method} ${path}` });
}

// Storage -----------------------------------------------------------------------------

const objectsDir = join(DATA_DIR, "objects");
const partsDir = join(DATA_DIR, "parts");
function objectPath(key) {
  const p = resolve(objectsDir, key);
  if (!p.startsWith(objectsDir + "/")) throw new ApiError(400, { message: "bad key" });
  return p;
}
const TYPES = { m3u8: "application/vnd.apple.mpegurl", m4s: "video/iso.segment", mp4: "video/mp4", webp: "image/webp", vtt: "text/vtt; charset=utf-8", webm: "video/webm", mov: "video/quicktime" };
const typeOf = (key) => TYPES[key.split(".").pop()] ?? "application/octet-stream";
const xml = (body) => ({ xml: `<?xml version="1.0" encoding="UTF-8"?>${body}` });

function walk(dir, prefix = "") {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]));
}

/** The handful of S3 calls the app and the worker make. No signatures are checked: it only listens on this machine. */
function s3(method, key, url, raw, res) {
  const q = url.searchParams;
  if (method === "POST" && q.has("uploads")) {
    const id = randomUUID();
    mkdirSync(join(partsDir, id), { recursive: true });
    return xml(`<InitiateMultipartUploadResult><Bucket>${BUCKET}</Bucket><Key>${key}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
  }
  if (method === "PUT" && q.has("partNumber")) {
    const dir = join(partsDir, q.get("uploadId").replace(/[^a-z0-9-]/gi, ""));
    if (!existsSync(dir)) throw new ApiError(404, { message: "NoSuchUpload" });
    writeFileSync(join(dir, String(Number(q.get("partNumber")))), raw);
    res.setHeader("ETag", `"${createHash("md5").update(raw).digest("hex")}"`);
    return null;
  }
  if (method === "POST" && q.has("uploadId")) {
    const dir = join(partsDir, q.get("uploadId").replace(/[^a-z0-9-]/gi, ""));
    if (!existsSync(dir)) throw new ApiError(404, { message: "NoSuchUpload" });
    const parts = readdirSync(dir).map(Number).sort((a, b) => a - b);
    const target = objectPath(key);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, Buffer.concat(parts.map((n) => readFileSync(join(dir, String(n))))));
    rmSync(dir, { recursive: true, force: true });
    return xml(`<CompleteMultipartUploadResult><Bucket>${BUCKET}</Bucket><Key>${key}</Key><ETag>"local"</ETag></CompleteMultipartUploadResult>`);
  }
  if (method === "DELETE" && q.has("uploadId")) {
    rmSync(join(partsDir, q.get("uploadId").replace(/[^a-z0-9-]/gi, "")), { recursive: true, force: true });
    return null;
  }
  if (method === "POST" && q.has("delete")) {
    for (const m of raw.toString().matchAll(/<Key>([^<]+)<\/Key>/g)) rmSync(objectPath(m[1]), { force: true });
    return xml("<DeleteResult></DeleteResult>");
  }
  if (method === "GET" && q.get("list-type") === "2") {
    const prefix = q.get("prefix") ?? "";
    const keys = walk(objectsDir).filter((k) => k.startsWith(prefix));
    const items = keys.map((k) => `<Contents><Key>${k}</Key><Size>${statSync(objectPath(k)).size}</Size></Contents>`).join("");
    return xml(`<ListBucketResult><Name>${BUCKET}</Name><Prefix>${prefix}</Prefix><KeyCount>${keys.length}</KeyCount><IsTruncated>false</IsTruncated>${items}</ListBucketResult>`);
  }
  if (method === "PUT") {
    const target = objectPath(key);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, raw);
    res.setHeader("ETag", '"local"');
    return null;
  }
  if (method === "GET" || method === "HEAD") return { file: objectPath(key), head: method === "HEAD" };
  throw new ApiError(400, { message: `the local stack does not know this storage call: ${method}` });
}

function sendFile(req, res, file, headOnly) {
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { "content-type": "application/xml" });
    return res.end(headOnly ? undefined : '<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code></Error>');
  }
  const size = statSync(file).size;
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
  const head = { "content-type": typeOf(file), "accept-ranges": "bytes", "cache-control": "public, max-age=60" };
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { ...head, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
    return headOnly ? res.end() : createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...head, "content-length": size });
  return headOnly ? res.end() : createReadStream(file).pipe(res);
}

// The server ----------------------------------------------------------------------------

function readBody(req) {
  return new Promise((done, fail) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => done(Buffer.concat(chunks)));
    req.on("error", fail);
  });
}

export function startServer() {
  mkdirSync(objectsDir, { recursive: true });
  mkdirSync(partsDir, { recursive: true });
  const server = createServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", req.headers.origin ?? "*");
    res.setHeader("access-control-allow-headers", req.headers["access-control-request-headers"] ?? "*");
    res.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS");
    res.setHeader("access-control-expose-headers", "ETag, Content-Range");
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    const url = new URL(req.url, BASE);
    const path = decodeURIComponent(url.pathname);
    try {
      if (path.startsWith("/media/") && (req.method === "GET" || req.method === "HEAD")) return sendFile(req, res, objectPath(path.slice(7)), req.method === "HEAD");
      const raw = await readBody(req);
      if (path.startsWith(`/s3/${BUCKET}`)) {
        const out = s3(req.method, path.slice(`/s3/${BUCKET}/`.length), url, raw, res);
        if (out?.file) return sendFile(req, res, out.file, out.head);
        if (out?.xml) return res.writeHead(200, { "content-type": "application/xml" }).end(out.xml);
        return res.writeHead(req.method === "DELETE" ? 204 : 200).end();
      }
      const body = raw.length ? JSON.parse(raw.toString()) : null;
      const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "") || req.headers.apikey;
      let out;
      if (path.startsWith("/auth/v1/")) out = await auth(path.slice(8), url, req.method, body, bearer);
      else if (path.startsWith("/rest/v1/")) {
        const claims = verify(bearer) ?? { role: "anon" };
        const wantObject = (req.headers.accept ?? "").includes("vnd.pgrst.object");
        const name = path.slice(9);
        if (name.startsWith("rpc/") && req.method === "POST") out = await rpc(name.slice(4), body, claims, wantObject);
        else if (req.method === "GET") out = await tableRead(name, url.searchParams, claims, wantObject);
        else if (req.method === "PATCH") out = await tableUpdate(name, url.searchParams, body, claims);
        else throw new ApiError(405, { code: "PGRST000", message: "the local stack only reads tables, updates rows and calls functions" });
      } else throw new ApiError(404, { message: "not found" });
      if (out === null || out === undefined) {
        // An rpc that answers null still answers JSON; the rest is "no content".
        if (path.startsWith("/rest/v1/rpc/")) return res.writeHead(200, { "content-type": "application/json" }).end("null");
        return res.writeHead(204).end();
      }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 500;
      const payload = err instanceof ApiError ? err.body : { code: "XX000", message: String(err?.message ?? err) };
      if (!(err instanceof ApiError)) console.error("local stack:", err);
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(payload));
    }
  });
  return new Promise((done) => server.listen(PORT, HOST === "127.0.0.1" ? "127.0.0.1" : "0.0.0.0", () => done(server)));
}

export const appEnv = () => ({
  NEXT_PUBLIC_SUPABASE_URL: BASE,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ANON_KEY,
  R2_ACCOUNT_ID: "local",
  R2_ACCESS_KEY_ID: "local",
  R2_SECRET_ACCESS_KEY: "local",
  R2_BUCKET: BUCKET,
  R2_ENDPOINT: `${BASE}/s3`,
  MEDIA_PUBLIC_URL: `${BASE}/media`,
});
export const workerEnv = () => ({ ...appEnv(), SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY });

if (import.meta.url === `file://${process.argv[1]}`) {
  if (flag("--reset")) {
    rmSync(DATA_DIR, { recursive: true, force: true });
    resetDatabase();
    console.log(`database ${DB_NAME}: shim and ${migrationFiles().length} migrations applied`);
  }
  await startServer();
  if (flag("--seed")) {
    const { seed } = await import("./local-seed.mjs");
    await seed({ adminQuery, hashPassword, objectsDir, mediaBase: `${BASE}/media` });
  }
  console.log(`\nlocal stack at ${BASE} (files in ${DATA_DIR})\n\nPut this in .env.local, then \`npm run dev\`:\n`);
  for (const [k, v] of Object.entries(appEnv())) console.log(`${k}=${v}`);
  console.log("\nFor the encoder worker (node worker/index.mjs), these as well:\n");
  console.log(`SUPABASE_URL=${BASE}\nSUPABASE_SERVICE_ROLE_KEY=${SERVICE_KEY}\n`);
  if (flag("--seed")) console.log("Made up accounts, all with the password yaptok-local: owner@example.com (admin), mira@example.com, tobi@example.com\n");
  const stop = () => pool.end().finally(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
