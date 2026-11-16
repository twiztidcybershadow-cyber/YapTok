// The worker's settings, read from the environment (the box's env file).
import { hostname, tmpdir } from "node:os";

export const REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
];

/**
 * Optional:
 *   WORKER_NAME       shown in encode_jobs.worker (default: the host name)
 *   WORK_DIR          where sources are downloaded and encoded (default: the system temp folder)
 *   STATE_DIR         where the busy marker for the update script lives (default: none)
 *   R2_ENDPOINT       another S3 compatible address instead of R2's own (local testing)
 *   MEDIA_PUBLIC_URL  https base that serves the bucket's hls/ files, for thumbnail_url.
 *                     Without it thumbnail_url stays empty and the app signs a link.
 */
export function readConfig(env = process.env) {
  const get = (name) => env[name]?.trim() || "";
  const missing = REQUIRED_ENV.filter((name) => !get(name));
  const publicUrl = get("MEDIA_PUBLIC_URL").replace(/\/+$/, "");
  return {
    missing,
    supabaseUrl: get("SUPABASE_URL"),
    serviceRoleKey: get("SUPABASE_SERVICE_ROLE_KEY"),
    r2: {
      accountId: get("R2_ACCOUNT_ID"),
      accessKeyId: get("R2_ACCESS_KEY_ID"),
      secretAccessKey: get("R2_SECRET_ACCESS_KEY"),
      // Another S3 address than R2's own, for local testing. Usually unset.
      endpoint: /^https?:\/\//.test(get("R2_ENDPOINT")) ? get("R2_ENDPOINT") : undefined,
    },
    bucket: get("R2_BUCKET"),
    workerName: get("WORKER_NAME") || hostname(),
    workDir: get("WORK_DIR") || tmpdir(),
    stateDir: get("STATE_DIR") || null,
    // https, or plain http on this machine for local testing.
    mediaPublicUrl: /^https:\/\//.test(publicUrl) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(publicUrl) ? publicUrl : null,
  };
}
