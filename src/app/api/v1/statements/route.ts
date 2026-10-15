import { api, searchParamsObject } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { AppError } from "@/server/errors";
import { listStatements, uploadStatement } from "@/server/services/statements";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const GET = api(async (req) => listStatements(await actor(), searchParamsObject(req)));

/** رفع كشف (multipart/form-data): file، و unitPrice (سعر الجرة على المواطن)، و costPrice (على الموزّع)، و title و supersedesId اختياريان. */
export const POST = api(async (req) => {
  const a = await actor();
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) throw new AppError("VALIDATION", "اختر ملف الكشف");
  return uploadStatement(
    a,
    { name: file.name, mime: file.type, data: Buffer.from(await file.arrayBuffer()) },
    { title: form.get("title") || undefined, supersedesId: form.get("supersedesId") || undefined, unitPrice: form.get("unitPrice") || undefined, costPrice: form.get("costPrice") || undefined },
  );
});
