import { api } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { readOwnFile } from "@/server/services/files";
import { getStatement } from "@/server/services/statements";

/** تنزيل الملف الأصلي للكشف. متاح لصاحب الكشف فقط، دون روابط عامة. */
export const GET = api<{ id: string }>(async (_req, { params }) => {
  const actor = await requireApiActor({ role: "DISTRIBUTOR" });
  const { statement } = await getStatement(actor, params.id, { page: 1 });
  const f = await readOwnFile(actor, statement.file.id);
  return new Response(new Uint8Array(f.data), {
    headers: {
      "Content-Type": f.mime,
      "Content-Disposition": `inline; filename="statement"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
