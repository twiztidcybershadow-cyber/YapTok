import { logText, type AdminLogEntry } from "@/lib/admin/types";
import { Empty } from "./AdminShell";

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC";
}

/** The audit log: every admin action, newest first, written by the database itself. */
export function LogList({ entries }: { entries: AdminLogEntry[] }) {
  if (entries.length === 0) return <Empty>Nothing has been changed yet. Every admin action shows up here.</Empty>;
  return (
    <ol className="card divide-y divide-divider" data-log-list>
      {entries.map((e) => (
        <li key={e.id} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4" data-log={e.action}>
          <time dateTime={e.createdAt} className="w-[150px] shrink-0 text-[12px] tabular-nums text-text-3">
            {when(e.createdAt)}
          </time>
          <p className="min-w-0 text-[14px] leading-5 text-text">
            <span className="font-medium">{e.actor ? `@${e.actor.username}` : "A deleted admin"}</span> {logText(e)}
          </p>
        </li>
      ))}
    </ol>
  );
}
