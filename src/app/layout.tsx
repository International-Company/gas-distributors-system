import type { Metadata, Viewport } from "next";
import { Cairo } from "next/font/google";
import { cache } from "react";
import { ThemeProvider } from "@/components/theme";
import { AppSplash } from "@/components/app-splash";
import { getPublicSettings } from "@/server/services/settings";
import "./globals.css";

// خط Cairo (اختيار المالك)، يُخدم من خادم التطبيق نفسه فيعمل دون اتصال.
const font = Cairo({ subsets: ["arabic", "latin"], weight: ["400", "500", "600", "700"], variable: "--font-arabic", display: "swap" });

// الإعدادات العامة مرة واحدة لكل طلب (العنوان وشاشة البداية).
const publicSettings = cache(() => getPublicSettings().catch(() => null));

export async function generateMetadata(): Promise<Metadata> {
  const s = await publicSettings();
  const name = s?.systemName ?? "نظام إدارة موزّعي الغاز";
  return {
    title: { default: name, template: `%s | ${name}` },
    robots: { index: false, follow: false },
    icons: { apple: "/icons/apple-touch-icon.png" },
    appleWebApp: { capable: true, title: name, statusBarStyle: "default" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1522" },
  ],
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const s = await publicSettings();
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning className={font.variable}>
      <body className="min-h-dvh">
        <AppSplash name={s?.systemName ?? "نظام إدارة موزّعي الغاز"} logoUrl={s?.logoUrl ?? null} />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
