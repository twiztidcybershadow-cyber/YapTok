/** Small notice shown in the navigation when the Supabase settings are missing. */
export function DbStatus() {
  return (
    <span
      title="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to connect"
      data-db-status
      className="inline-flex h-7 items-center gap-1.5 rounded-full bg-hover px-2.5 text-[12px] text-text-2"
    >
      <span className="h-2 w-2 rounded-full bg-[var(--warn)]" />
      database not connected
    </span>
  );
}
