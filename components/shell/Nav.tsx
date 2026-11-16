"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Avatar } from "@/components/Avatar";
import { DbStatus } from "@/components/DbStatus";
import { BellIcon, DarkThemeIcon, HomeIcon, LogoMark, PlusIcon, SearchIcon, SettingsIcon, ShieldIcon, SignOutIcon, UserIcon } from "@/components/icons";
import { useSession } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";
import { callRpc } from "@/lib/social/client";
import { unreadBadge } from "@/lib/social/inbox";
import { createClient } from "@/lib/supabase/client";

type Item = { href: string; label: string; icon: ReactNode; active: boolean; key: string; badge?: string | null };

/** Asks how many unread inbox items there are, once per page the person opens. */
function useUnread(on: boolean, messages: boolean): number {
  const path = usePathname();
  const unread = useUi((s) => s.unread);
  useEffect(() => {
    if (!on) return;
    void Promise.all([callRpc<number>("inbox_unread"), messages ? callRpc<number>("dm_unread") : null]).then(([a, b]) => {
      useUi.getState().setUnread((a.ok ? Number(a.data) || 0 : 0) + (b?.ok ? Number(b.data) || 0 : 0));
    });
  }, [on, messages, path]);
  return on ? unread : 0;
}

/** The places the navigation links to, for this person and these flags. */
function useNavItems(): Item[] {
  const path = usePathname();
  const user = useSession((s) => s.user);
  const flags = useSession((s) => s.flags);
  const admin = useSession((s) => s.admin);
  const unread = useUnread(user !== null && flags.inbox === true, flags.messages === true);
  // A feature that is off has no link: the navigation only lists what is switched on.
  const items: Item[] = [];
  if (flags.feed) {
    items.push({ key: "home", href: "/", label: "For You", icon: <HomeIcon className="h-6 w-6" />, active: path === "/" || path === "/following" || path.startsWith("/v/") });
  }
  if (flags.search) {
    items.push({ key: "search", href: "/search", label: "Discover", icon: <SearchIcon className="h-6 w-6" />, active: path === "/search" || path.startsWith("/tag/") });
  }
  if (flags.upload) {
    items.push({
      key: "upload",
      href: user ? "/upload" : "/login?next=/upload",
      label: "Upload",
      icon: <PlusIcon className="h-6 w-6" />,
      active: path === "/upload",
    });
  }
  if (user && flags.inbox) {
    items.push({ key: "inbox", href: "/inbox", label: "Inbox", icon: <BellIcon className="h-6 w-6" />, active: path === "/inbox" || path.startsWith("/messages"), badge: unreadBadge(unread) });
  }
  if (user && flags.profiles) {
    const href = `/@${user.username}`;
    items.push({ key: "profile", href, label: "Profile", icon: <UserIcon className="h-6 w-6" />, active: path === href || path === `/u/${user.username}` });
  }
  if (!user && flags.accounts) {
    items.push({ key: "login", href: "/login", label: "Sign in", icon: <UserIcon className="h-6 w-6" />, active: path === "/login" || path === "/signup" });
  }
  if (admin && flags.admin) {
    items.push({ key: "admin", href: "/admin", label: "Admin", icon: <ShieldIcon className="h-6 w-6" />, active: path.startsWith("/admin") });
  }
  return items;
}

function Badge({ text }: { text: string }) {
  return (
    <span data-unread-badge className="absolute -right-2 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--accent)] px-1 text-[11px] font-bold leading-none text-black">
      {text}
    </span>
  );
}

export function Logo() {
  return (
    <Link href="/" aria-label="YapTok home" className="flex h-14 items-center gap-2 px-4">
      <LogoMark className="h-8 w-8" />
      <span className="text-[22px] font-bold leading-none tracking-[-0.6px] text-text">
        <span className="text-[var(--logo-word)]">Yap</span>Tok
      </span>
    </Link>
  );
}

/** The rail on the left of a desk: logo, the places to go, then the account. */
export function SideRail() {
  const router = useRouter();
  const items = useNavItems();
  const user = useSession((s) => s.user);
  const loaded = useSession((s) => s.loaded);
  const config = useSession((s) => s.config);
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const syncTheme = useUi((s) => s.syncTheme);
  useEffect(syncTheme, [syncTheme]);

  async function signOut() {
    await createClient()?.auth.signOut();
    router.push("/");
    router.refresh();
  }

  const row = "flex h-12 items-center gap-4 rounded-xl px-3 text-[15px] font-medium text-text hover:bg-hover";
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[220px] flex-col border-r border-divider bg-page desk:flex" data-side-rail>
      <Logo />
      <nav aria-label="Main" className="flex-1 space-y-1 px-2 pt-2">
        {items.map((item) => (
          <Link key={item.key} href={item.href} prefetch={false} aria-current={item.active ? "page" : undefined} className={`${row} ${item.active ? "bg-hover text-[var(--link)]" : ""}`}>
            <span className="relative">
              {item.icon}
              {item.badge && <Badge text={item.badge} />}
            </span>
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="space-y-1 border-t border-divider p-2">
        {loaded && !config && (
          <div className="px-1 pb-1">
            <DbStatus />
          </div>
        )}
        <button type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className={`${row} w-full`} data-theme-toggle>
          <DarkThemeIcon className="h-6 w-6" />
          {theme === "dark" ? "Light theme" : "Dark theme"}
        </button>
        {user && (
          <>
            <Link href="/settings" className={row}>
              <SettingsIcon className="h-6 w-6" />
              Settings
            </Link>
            <button type="button" onClick={() => void signOut()} className={`${row} w-full`}>
              <SignOutIcon className="h-6 w-6" />
              Sign out
            </button>
            <div className="flex items-center gap-3 px-3 py-2">
              <Avatar name={user.displayName} url={user.avatarUrl} size={32} />
              <div className="min-w-0">
                <p className="truncate text-[14px] font-medium text-text">{user.displayName}</p>
                <p className="truncate text-[12px] text-text-2">@{user.username}</p>
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

/** The bar at the bottom of a phone. The upload button is the big one in the middle. */
export function BottomBar() {
  const items = useNavItems();
  const loaded = useSession((s) => s.loaded);
  const config = useSession((s) => s.config);
  // Settings is not in the bar: "Edit profile" on your own page leads there.
  const all = items;
  return (
    <nav
      aria-label="Main"
      data-bottom-bar
      className="fixed inset-x-0 bottom-0 z-40 flex h-[var(--bottom-bar)] items-start justify-around border-t border-divider bg-page pb-[env(safe-area-inset-bottom)] desk:hidden"
    >
      {all.map((item) =>
        item.key === "upload" ? (
          <Link key={item.key} href={item.href} prefetch={false} aria-label="Upload" className="mt-2 grid h-10 w-14 place-items-center rounded-2xl bg-[var(--brand-strong)] text-white">
            {item.icon}
          </Link>
        ) : (
          <Link
            key={item.key}
            href={item.href}
            prefetch={false}
            aria-current={item.active ? "page" : undefined}
            className={`flex h-14 min-w-14 flex-col items-center justify-center gap-0.5 px-2 text-[11px] font-medium ${item.active ? "text-[var(--link)]" : "text-text-2"}`}
          >
            <span className="relative">
              {item.icon}
              {item.badge && <Badge text={item.badge} />}
            </span>
            {item.label}
          </Link>
        ),
      )}
      {loaded && !config && (
        <span className="absolute -top-8 right-2">
          <DbStatus />
        </span>
      )}
    </nav>
  );
}

/** The owner's banner line from /admin/settings, at the top of every page. */
export function Banner() {
  const banner = useSession((s) => s.settings.banner);
  if (!banner) return null;
  return (
    <p role="status" data-banner className="flex h-9 items-center justify-center truncate bg-[var(--brand-strong)] px-4 text-[13px] font-medium text-white">
      <span className="truncate">{banner}</span>
    </p>
  );
}
