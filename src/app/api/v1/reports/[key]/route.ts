import { api, searchParamsObject } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { runReport } from "@/server/reports/service";

/** تشغيل تقرير. للمدير: distributorId مطلوب وصلاحية reports.view. */
export const GET = api<{ key: string }>(async (req, { params }) => {
  const { distributorId, ...rest } = searchParamsObject(req);
  return runReport(await requireApiActor(), params.key, rest, { distributorId });
});
