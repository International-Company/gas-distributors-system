import { api, searchParamsObject } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { auditExport, reportToXlsx, runReport, xlsxFileName } from "@/server/reports/service";
import { getPublicSettings } from "@/server/services/settings";

export const GET = api<{ key: string }>(async (req, { params }) => {
  const actor = await requireApiActor();
  const { distributorId, ...rest } = searchParamsObject(req);
  const r = await runReport(actor, params.key, rest, { distributorId });
  const buf = await reportToXlsx(r, (await getPublicSettings()).systemName);
  await auditExport(actor, params.key, "xlsx", rest, actor.distributorId ?? distributorId ?? null, r.rows.length);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="report.xlsx"; filename*=UTF-8''${encodeURIComponent(xlsxFileName(r))}`,
      "Cache-Control": "no-store",
    },
  });
});
