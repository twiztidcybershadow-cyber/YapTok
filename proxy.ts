import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { evaluateFlag, isFlagMode } from "@/lib/flags-core";
import { readSupabaseConfig } from "@/lib/supabase/env";

const isAdminPath = (path: string) => path === "/admin" || path.startsWith("/admin/");

/**
 * /admin for anyone but an admin: the plain 404 page, with a real 404
 * status, so the panel does not even show that it exists. A rewrite to a path
 * no route answers gives exactly that. The pages check again themselves, and
 * every admin action is checked a third time in the database.
 */
function hidden(request: NextRequest, keep?: NextResponse) {
  const url = request.nextUrl.clone();
  url.pathname = "/_not-an-admin-page";
  url.search = "";
  const out = NextResponse.rewrite(url, { status: 404 });
  // Keep refreshed session cookies.
  for (const c of keep?.cookies.getAll() ?? []) out.cookies.set(c);
  return out;
}

/**
 * Runs before every page request and keeps the Supabase session fresh.
 * Server Components can read cookies but not write them, so an expired
 * access token is refreshed here and the new cookies go on the response.
 * This is the @supabase/ssr pattern, in Next 16's proxy.ts (formerly middleware).
 */
export async function proxy(request: NextRequest) {
  const config = readSupabaseConfig();
  const adminPath = isAdminPath(request.nextUrl.pathname);
  // Without a database, `next dev` shows a preview of /admin; production hides it.
  if (!config) return adminPath && process.env.NODE_ENV !== "development" ? hidden(request) : NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        // Update the request so Server Components in this render see the new
        // tokens, and the response so the browser stores them.
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // Responses that set auth cookies must never be cached.
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Validates the token and refreshes it when it is about to expire.
  // Do not put code between createServerClient and this call.
  const { data } = await supabase.auth.getClaims();
  const sub = (data?.claims?.sub as string | undefined) ?? null;

  // One small question per page for a signed in person: banned? admin?
  // (session_status in 003_profiles.sql.)
  let admin = false;
  if (sub) {
    const { data: status } = await supabase.rpc("session_status");
    const s = status as { banned?: boolean; admin?: boolean } | null;
    admin = s?.admin === true;
    // A banned account is signed out on its next page.
    if (s?.banned === true) {
      await supabase.auth.signOut({ scope: "local" });
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "?banned=1";
      const out = NextResponse.redirect(url);
      for (const c of response.cookies.getAll()) out.cookies.set(c);
      out.headers.set("Cache-Control", "private, no-store");
      return out;
    }
  }

  if (adminPath) {
    if (!sub || !admin) return hidden(request, response);
    const { data: flag } = await supabase.from("feature_flags").select("mode, users").eq("key", "admin").maybeSingle();
    const on = flag && isFlagMode(flag.mode) && evaluateFlag({ mode: flag.mode, users: flag.users ?? [] }, sub);
    if (!on) return hidden(request, response);
  }

  return response;
}

export const config = {
  // Every page, but not static files, images or the health and version checks.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|api/version|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
