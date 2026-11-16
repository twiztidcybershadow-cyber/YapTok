"use client";

import { rpcCode } from "@/lib/feed/format";
import { createClient } from "@/lib/supabase/client";

export type RpcResult<T> = { ok: true; data: T } | { ok: false; code: string };

/**
 * Calls one of the database functions as the signed in person. Everything the
 * app writes goes through these functions; they check the flag, the ban and
 * the rules themselves, so the browser can call them directly.
 */
export async function callRpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<RpcResult<T>> {
  const supabase = createClient();
  if (!supabase) return { ok: false, code: "no_db" };
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, code: rpcCode(error) ?? "error" };
  return { ok: true, data: data as T };
}

/** Where to send a signed out person who tapped something that needs an account. */
export function loginUrl(next: string): string {
  return `/login?next=${encodeURIComponent(next)}`;
}
