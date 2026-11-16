import "server-only";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

type Db = NonNullable<Awaited<ReturnType<typeof createClient>>>;

export type AdminGate =
  /** `next dev` without a database: the pages show made up rows, read only. */
  | { kind: "preview" }
  | { kind: "ready"; db: Db; userId: string };

/**
 * Who may see a page under /admin. Anyone else gets the plain 404 page:
 * proxy.ts already answers that way, this is the second lock. The third is in
 * the database, where every admin function checks the admins table itself.
 * Reads the request, so call it inside <Suspense>.
 */
export async function adminGate(): Promise<AdminGate> {
  await connection();
  if (!readSupabaseConfig()) {
    if (process.env.NODE_ENV === "development") return { kind: "preview" };
    notFound();
  }
  const user = await getCurrentUser();
  if (!user?.admin || !(await flagOn("admin", user.id))) notFound();
  const db = await createClient();
  if (!db) notFound();
  return { kind: "ready", db, userId: user.id };
}

/** Calls one of the admin_* read functions. Null when it fails (migrations missing). */
export async function adminRead(db: Db, fn: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const { data, error } = await db.rpc(fn, args);
  return error ? null : data;
}
