import type { MetadataRoute } from "next";
import { getPublicSettings } from "@/server/services/settings";

/** بيان التطبيق: يجعل النظام قابلًا للتثبيت على الهاتف والكمبيوتر. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const s = await getPublicSettings().catch(() => null);
  const name = s?.systemName ?? "نظام إدارة موزّعي الغاز";
  return {
    name,
    short_name: "موزّعو الغاز",
    description: "إدارة الكشوف والجرار والتحصيل لموزّعي الغاز",
    lang: "ar",
    dir: "rtl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    // شاشة النظام عند فتح التطبيق: خلفية الهوية الزرقاء نفسها التي تكملها شاشة البداية داخل التطبيق.
    background_color: "#1e5aa8",
    theme_color: "#1e5aa8",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

export const dynamic = "force-dynamic";
