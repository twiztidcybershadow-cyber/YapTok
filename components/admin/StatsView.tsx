"use client";

import { useState } from "react";
import { dayLabel, niceMax, type AdminStats, type StatDay } from "@/lib/admin/types";
import { compactCount } from "@/lib/feed/format";

function Tile({ label, value, note, tone }: { label: string; value: number; note?: string; tone?: "warn" }) {
  return (
    <div className="card px-4 py-3" data-stat={label}>
      <p className="text-[13px] text-text-2">{label}</p>
      <p className={`mt-1 text-[26px] font-bold leading-8 tabular-nums ${tone === "warn" && value > 0 ? "text-warn" : "text-text"}`}>{value.toLocaleString("en-US")}</p>
      {note && <p className="text-[12px] text-text-3">{note}</p>}
    </div>
  );
}

const W = 560;
const H = 180;
const PAD = { top: 12, right: 8, bottom: 24, left: 36 };

/**
 * One measure per day as thin bars: one series, one hue, so the title names
 * it and there is no legend. Each chart has its own scale starting at zero
 * (three small charts instead of one chart with several axes). Hover or focus
 * a bar for the day and the exact number; the table under the charts has
 * every number as text.
 */
function DayBars({ title, days, pick }: { title: string; days: StatDay[]; pick: (d: StatDay) => number }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = days.map(pick);
  const max = niceMax(values);
  const total = values.reduce((a, b) => a + b, 0);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(1, days.length);
  const barW = Math.min(24, Math.max(4, slot - 2));
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const shown = hover !== null ? days[hover] : null;

  return (
    <figure className="card p-4" data-chart={title}>
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-[15px] font-medium text-text">{title}</span>
        <span className="text-[13px] tabular-nums text-text-2" aria-live="polite">
          {shown ? `${dayLabel(shown.day)}: ${pick(shown).toLocaleString("en-US")}` : `${total.toLocaleString("en-US")} in ${days.length} days`}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label={`${title} per day, ${total} in ${days.length} days`} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(max * f)} y2={y(max * f)} stroke="var(--divider)" strokeWidth="1" />
            <text x={PAD.left - 6} y={y(max * f) + 4} textAnchor="end" fontSize="11" fill="var(--text-3)">
              {compactCount(max * f)}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const v = pick(d);
          const x = PAD.left + slot * i + (slot - barW) / 2;
          const h = Math.max(v > 0 ? 2 : 0, PAD.top + plotH - y(v));
          const r = Math.min(4, barW / 2, h);
          const top = PAD.top + plotH - h;
          const edge = i === 0 || i === days.length - 1 || i === Math.floor(days.length / 2);
          return (
            <g key={d.day}>
              {v > 0 && (
                // A bar with rounded top corners, flat on the baseline.
                <path
                  d={`M${x},${PAD.top + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${PAD.top + plotH} Z`}
                  fill="var(--brand)"
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              )}
              {edge && (
                <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--text-3)">
                  {dayLabel(d.day)}
                </text>
              )}
              {/* The hover target is the whole column, bigger than the bar. */}
              <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={plotH} fill="transparent" tabIndex={0} aria-label={`${dayLabel(d.day)}: ${v}`} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Totals, what is waiting for an admin, and sign-ups, uploads and views per day. */
export function StatsView({ stats, days }: { stats: AdminStats; days: number }) {
  const t = stats.totals;
  return (
    <div className="space-y-4" data-stats>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Accounts" value={t.accounts} note={t.banned > 0 ? `${t.banned} banned` : undefined} />
        <Tile label="Live clips" value={t.clips} />
        <Tile label="Views, all time" value={t.views} />
        <Tile label="Open reports" value={t.openReports} tone="warn" />
        <Tile label="Waiting for the encoder" value={t.inQueue} />
        <Tile label="Failed this week" value={t.failed} tone="warn" />
      </div>
      <div className="flex gap-2">
        {[7, 14, 30].map((n) => (
          <a key={n} href={`/admin/stats?days=${n}`} aria-current={days === n ? "page" : undefined} className={`pill !h-8 !px-4 !text-[13px] ${days === n ? "!bg-[var(--brand-strong)] !text-white" : ""}`}>
            {n} days
          </a>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <DayBars title="Sign-ups" days={stats.days} pick={(d) => d.signups} />
        <DayBars title="Uploads" days={stats.days} pick={(d) => d.uploads} />
        <DayBars title="Views" days={stats.days} pick={(d) => d.views} />
      </div>
      <details className="card p-4">
        <summary className="cursor-pointer text-[14px] font-medium text-text">The numbers as a table</summary>
        <table className="mt-3 w-full text-left text-[13px] tabular-nums">
          <thead className="text-text-2">
            <tr>
              <th className="py-1 font-medium">Day (UTC)</th>
              <th className="py-1 text-right font-medium">Sign-ups</th>
              <th className="py-1 text-right font-medium">Uploads</th>
              <th className="py-1 text-right font-medium">Views</th>
            </tr>
          </thead>
          <tbody>
            {[...stats.days].reverse().map((d) => (
              <tr key={d.day} className="border-t border-divider">
                <td className="py-1">{dayLabel(d.day)}</td>
                <td className="py-1 text-right">{d.signups}</td>
                <td className="py-1 text-right">{d.uploads}</td>
                <td className="py-1 text-right">{d.views}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
