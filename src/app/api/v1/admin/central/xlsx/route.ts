import { api, searchParamsObject } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { auditExport, centralOverviewReport, reportToXlsx, xlsxFileName } from "@/server/reports/service";
import { getPublicSettings } from "@/server/services/settings";

export const GET = api(async (req) => {
  const actor = await requireApiActor({ role: "ADMIN" });
  const params = searchParamsObject(req);
  const r = await centralOverviewReport(actor, params);
  const buf = await reportToXlsx(r, (await getPublicSettings()).systemName);
  await auditExport(actor, "central", "xlsx", params, null, r.rows.length);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="central.xlsx"; filename*=UTF-8''${encodeURIComponent(xlsxFileName(r))}`,
      "Cache-Control": "no-store",
    },
  });
});
