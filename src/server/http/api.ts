import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { AppError } from "../errors";
import { logError } from "../services/logs";
import { currentSession } from "./context";

type Params = Record<string, string>;
type Handler<P extends Params> = (req: NextRequest, ctx: { params: P }) => Promise<Response | unknown>;

/**
 * يغلّف كل واجهة API:
 * - يتحقق من أصل الطلب (Origin) للطلبات المعدِّلة لمنع CSRF.
 * - يحوّل الأخطاء المتوقعة إلى JSON موحد برسالة عربية.
 * - يسجل الأخطاء غير المتوقعة في سجل الأخطاء دون كشف تفاصيلها للعميل.
 */
export function api<P extends Params = Params>(handler: Handler<P>) {
  return async (req: NextRequest, ctx: { params: Promise<P> }) => {
    try {
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) assertSameOrigin(req);
      const result = await handler(req, { params: await ctx.params });
      if (result instanceof Response) return result;
      return jsonResponse({ data: result ?? null });
    } catch (err) {
      return errorResponse(err, req);
    }
  };
}

/** JSON مع تحويل BigInt (معرّفات السجلات) إلى نص. */
function jsonResponse(body: unknown, status = 200) {
  const text = JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  return new Response(text, { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) throw new AppError("FORBIDDEN", "طلب غير مسموح");
  if (new URL(origin).host !== host) throw new AppError("FORBIDDEN", "طلب من مصدر غير مسموح");
}

async function errorResponse(err: unknown, req: NextRequest) {
  if (err instanceof AppError) {
    return NextResponse.json({ error: { code: err.code, message: err.message, fields: err.fields } }, { status: err.status });
  }
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const i of err.issues) fields[i.path.join(".") || "_"] ??= i.message;
    const first = err.issues[0]?.message ?? "بيانات غير صالحة";
    return NextResponse.json({ error: { code: "VALIDATION", message: first, fields } }, { status: 400 });
  }
  if (err instanceof SyntaxError) {
    return NextResponse.json({ error: { code: "VALIDATION", message: "صيغة الطلب غير صالحة" } }, { status: 400 });
  }
  const session = await currentSession().catch(() => null);
  await logError(err, { route: `${req.method} ${req.nextUrl.pathname}`, userId: session?.actor.userId });
  return NextResponse.json({ error: { code: "INTERNAL", message: "حدث خطأ غير متوقع، تم تسجيله لدى الإدارة" } }, { status: 500 });
}

export async function readJson(req: NextRequest): Promise<unknown> {
  const text = await req.text();
  return text ? JSON.parse(text) : {};
}

export function searchParamsObject(req: NextRequest) {
  return Object.fromEntries(req.nextUrl.searchParams.entries());
}
