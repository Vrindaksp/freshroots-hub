import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { KillSwitchBanner, KillSwitchControl } from "@/components/KillSwitch";
import { Tour } from "@/components/Tour";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Freshroots Operations Hub",
  description: "Demand planning and operations intelligence for Freshroots",
};

// Runs before first paint so the saved (or OS) theme never flashes the wrong colours.
const themeInit = `(function(){try{var s=localStorage.getItem('fr-theme');var d=s?s==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d)}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-full flex flex-col">
        <AppHeader
          controls={
            <Suspense fallback={<span className="inline-block h-8 w-28 rounded-md bg-white/10" aria-hidden />}>
              <KillSwitchControl />
            </Suspense>
          }
        />
        <Suspense fallback={null}>
          <KillSwitchBanner />
        </Suspense>
        <main className="mx-auto w-full max-w-[1480px] flex-1 px-4 pb-16 pt-6 sm:px-6">{children}</main>
        <Tour />
      </body>
    </html>
  );
}
