import "server-only";

/** The names of the R2 settings. Server only: never prefix them with NEXT_PUBLIC. */
export const R2_ENV = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] as const;

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Another S3 address than R2's own (R2_ENDPOINT), for local testing. Usually unset. */
  endpoint?: string;
};

/**
 * Reads the R2 settings at request time, like lib/supabase/env.ts, so one
 * Docker image works with whatever is in /opt/yaptok/.env.
 * Returns null when any of the four is missing. R2_ENDPOINT is optional: it
 * points the same code at another S3 compatible store (scripts/local-stack.mjs
 * uses it for its stand in).
 */
export function readR2Config(): R2Config | null {
  const env = process.env;
  const [accountId, accessKeyId, secretAccessKey, bucket] = R2_ENV.map((name) => env[name]?.trim());
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  const endpoint = env["R2_ENDPOINT"]?.trim();
  return { accountId, accessKeyId, secretAccessKey, bucket, ...(endpoint && /^https?:\/\//.test(endpoint) ? { endpoint } : {}) };
}
