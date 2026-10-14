import { api } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { listReports } from "@/server/reports/service";

export const GET = api(async () => {
  await requireApiActor();
  return listReports();
});
