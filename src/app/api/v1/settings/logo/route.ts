import { getLogo } from "@/server/services/settings";

/** الشعار عام (يظهر في صفحة الدخول). نوعه متحقق منه عند الرفع، ولا يُقبل SVG. */
export async function GET() {
  const l = await getLogo();
  if (!l?.logoData || !l.logoMime) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(l.logoData), {
    headers: { "Content-Type": l.logoMime, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" },
  });
}
