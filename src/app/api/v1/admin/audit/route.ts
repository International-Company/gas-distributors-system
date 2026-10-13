import { api, searchParamsObject } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { listAuditLogs } from "@/server/services/logs";

export const GET = api(async (req) => listAuditLogs(await requireApiActor({ role: "ADMIN" }), searchParamsObject(req)));
