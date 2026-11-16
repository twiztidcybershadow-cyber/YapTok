import type { ReactNode } from "react";
import { BRAND, MARK_HEAD, MARK_LAYERS, MARK_STEM, MARK_VIEWBOX } from "@/lib/brand";

type IconProps = { className?: string };

/** A 24 px line icon: 2 px rounded strokes in the current text color. All drawn for YapTok. */
function line(children: ReactNode) {
  return function Icon({ className }: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        className={className}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {children}
      </svg>
    );
  };
}

/** A 24 px solid icon in the current text color. */
function solid(children: ReactNode) {
  return function Icon({ className }: IconProps) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
        {children}
      </svg>
    );
  };
}

/** The YapTok mark: the orange eighth note with a lit edge (lib/brand.ts). */
export function LogoMark({ className }: IconProps) {
  return (
    <svg viewBox={MARK_VIEWBOX} className={className} aria-hidden>
      {MARK_LAYERS.map((l) => (
        <g
          key={l.tone}
          transform={`translate(${l.dx} ${l.dy})`}
          fill={l.tone === "light" ? BRAND.markLight : l.tone === "dark" ? BRAND.markDark : "var(--mark)"}
        >
          <path d={MARK_HEAD} />
          <path d={MARK_STEM} />
        </g>
      ))}
    </svg>
  );
}

export const HomeIcon = line(<path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />);
export const PlusIcon = line(<path d="M12 5v14M5 12h14" />);
export const UserIcon = line(
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
  </>,
);
export const HeartIcon = solid(
  <path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.2 2.8 4.5 6.5 4.5c2.1 0 3.8 1.1 5.5 3.2 1.7-2.1 3.4-3.2 5.5-3.2 3.7 0 5.6 3.7 4.1 7.2C19.5 16.4 12 21 12 21z" />,
);
export const CommentIcon = solid(
  <path d="M12 3c5.2 0 9.5 3.6 9.5 8.2s-4.3 8.2-9.5 8.2c-.9 0-1.8-.1-2.6-.3l-4.2 2.2c-.6.3-1.3-.2-1.1-.9l.9-3.6C3.4 15.3 2.5 13.3 2.5 11.2 2.5 6.6 6.8 3 12 3z" />,
);
export const ShareIcon = solid(
  <path d="M13.5 4.6c0-.9 1.1-1.3 1.7-.7l6.3 6.4c.4.4.4 1 0 1.4l-6.3 6.4c-.6.6-1.7.2-1.7-.7v-3c-4.3 0-7.4 1.2-9.7 4.3-.4.5-1.3.2-1.2-.5.7-5.5 4.2-9.9 10.9-10.6z" />,
);
export const BookmarkIcon = solid(<path d="M7 3h10a2 2 0 0 1 2 2v15.2c0 .8-.9 1.3-1.6.8L12 17.3 6.6 21c-.7.5-1.6 0-1.6-.8V5a2 2 0 0 1 2-2z" />);
export const BellIcon = line(<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0" />);
export const VolumeIcon = line(
  <>
    <path d="M4 9.5h3l5-4v13l-5-4H4z" />
    <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />
  </>,
);
export const MutedIcon = line(
  <>
    <path d="M4 9.5h3l5-4v13l-5-4H4z" />
    <path d="m16 9.5 5 5M21 9.5l-5 5" />
  </>,
);
export const PlayIcon = solid(<path d="M8 5.2c0-.8.9-1.3 1.6-.8l9.6 6.8c.600.4.600 1.2 0 1.6l-9.6 6.8c-.7.5-1.6 0-1.6-.8z" />);
export const MoreIcon = solid(
  <>
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </>,
);
export const FlagIcon = line(<path d="M5 21V4h11l-1.5 4L16 12H5" />);
export const CloseIcon = line(<path d="M6 6l12 12M18 6 6 18" />);
export const CheckIcon = line(<path d="m5 12.5 4.5 4.5L19 7.5" />);
export const ChevronUpIcon = line(<path d="m6 15 6-6 6 6" />);
export const ChevronDownIcon = line(<path d="m6 9 6 6 6-6" />);
export const ChevronRightIcon = line(<path d="m9 6 6 6-6 6" />);
export const SettingsIcon = line(
  <>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </>,
);
export const SignOutIcon = line(<path d="M10 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M15 8l4 4-4 4M19 12H9" />);
export const DarkThemeIcon = line(<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />);
export const ShieldIcon = line(
  <>
    <path d="M12 3 5 6v5.5c0 4.3 2.9 8 7 9.5 4.1-1.5 7-5.2 7-9.5V6z" />
    <path d="m9 12 2.2 2.2L15 10.5" />
  </>,
);
export const TrashIcon = line(<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v5M14 11v5" />);
export const CameraIcon = line(
  <>
    <rect x="3" y="7" width="13" height="10" rx="2" />
    <path d="m16 10.5 5-2.5v8l-5-2.5" />
  </>,
);
export const UploadIcon = line(<path d="M12 16V5M7.5 9.5 12 5l4.5 4.5M5 19h14" />);
export const SearchIcon = line(
  <>
    <circle cx="11" cy="11" r="6" />
    <path d="m20 20-4.5-4.5" />
  </>,
);
export const LinkIcon = line(
  <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1" />,
);
export const ChartIcon = line(<path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6" />);
export const ListIcon = line(<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />);
export const ToggleIcon = line(
  <>
    <rect x="2" y="7" width="20" height="10" rx="5" />
    <circle cx="16" cy="12" r="2" />
  </>,
);
export const ClipIcon = line(
  <>
    <rect x="6" y="3" width="12" height="18" rx="2.5" />
    <path d="m10.5 9.5 4 2.5-4 2.5z" />
  </>,
);

/** The small "verified" badge next to a creator's name. */
export function VerifiedIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label="Verified">
      <circle cx="12" cy="12" r="10" fill="var(--brand)" />
      <path d="m7.5 12.3 3 3 6-6.3" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
