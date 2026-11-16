import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Roboto } from "next/font/google";
import { OnboardingGuard } from "@/components/OnboardingGuard";
import { AdminShortcut } from "@/components/shell/AdminShortcut";
import { Banner, BottomBar, SideRail } from "@/components/shell/Nav";
import { SessionLoader } from "@/components/shell/SessionLoader";
import { Toast } from "@/components/Toast";
import { BRAND } from "@/lib/brand";
import { themeScript } from "@/lib/theme";
import { siteConfig } from "@/site.config";
import "./globals.css";

const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-roboto",
});

export const metadata: Metadata = {
  title: siteConfig.siteName,
  description: siteConfig.description,
};

export const viewport: Viewport = {
  themeColor: BRAND.ink,
  // The feed is full screen: draw under the notch and the home indicator.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the inline script adds the "dark" class before React hydrates.
    <html lang="en" className={`${roboto.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full">
        <a href="#content" className="skip-link">
          Skip to content
        </a>
        <Suspense fallback={null}>
          <SessionLoader />
        </Suspense>
        <Suspense fallback={null}>
          <OnboardingGuard />
        </Suspense>
        <Suspense fallback={null}>
          <SideRail />
        </Suspense>
        <div className="pb-[var(--bottom-bar)] desk:pl-[220px]">
          <Banner />
          <main id="content" tabIndex={-1} className="min-w-0 outline-none">
            {children}
          </main>
        </div>
        <Suspense fallback={null}>
          <BottomBar />
        </Suspense>
        <Suspense fallback={null}>
          <AdminShortcut />
        </Suspense>
        <Toast />
      </body>
    </html>
  );
}
