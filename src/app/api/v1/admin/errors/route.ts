import { api, searchParamsObject } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { listErrorLogs } from "@/server/services/logs";

export const GET = api(async (req) => listErrorLogs(await requireApiActor({ role: "ADMIN" }), searchParamsObject(req)));
