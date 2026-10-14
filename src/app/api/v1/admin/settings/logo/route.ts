import { api } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { AppError } from "@/server/errors";
import { setLogo } from "@/server/services/settings";

/** رفع الشعار (multipart: file). */
export const POST = api(async (req) => {
  const actor = await requireApiActor({ role: "ADMIN" });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new AppError("VALIDATION", "اختر صورة الشعار");
  return setLogo(actor, Buffer.from(await file.arrayBuffer()));
});

export const DELETE = api(async () => setLogo(await requireApiActor({ role: "ADMIN" }), null));
