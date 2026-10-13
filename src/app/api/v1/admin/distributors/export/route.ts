import { api, searchParamsObject } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { exportDistributorsXlsx } from "@/server/services/export";
import { toDateInput } from "@/lib/format";

export const GET = api(async (req) => {
  const buf = await exportDistributorsXlsx(await requireApiActor({ role: "ADMIN" }), searchParamsObject(req));
  const name = encodeURIComponent(`الموزعون-${toDateInput(new Date())}.xlsx`);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="distributors.xlsx"; filename*=UTF-8''${name}`,
      "Cache-Control": "no-store",
    },
  });
});
