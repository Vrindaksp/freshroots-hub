import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppHeader } from "@/components/AppHeader";
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
        <AppHeader />
        <main className="mx-auto w-full max-w-[1480px] flex-1 px-4 pb-16 pt-6 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
