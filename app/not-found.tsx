import Link from "next/link";
import { LogoMark } from "@/components/icons";

export const metadata = { title: "Not found | YapTok", robots: { index: false } };

/** Any address that leads nowhere, with a real 404 status. */
export default function NotFound() {
  return (
    <div data-error-state="404" className="flex min-h-[calc(100dvh-var(--bottom-bar))] flex-col items-center justify-center px-6 text-center">
      <LogoMark className="h-16 w-16 opacity-60 grayscale" />
      <h1 className="mt-5 text-[20px] font-medium text-text">This page isn&apos;t here.</h1>
      <p className="mt-2 text-[14px] text-text-2">The link may be wrong.</p>
      <Link href="/" className="btn-primary mt-5">
        Back home
      </Link>
    </div>
  );
}
