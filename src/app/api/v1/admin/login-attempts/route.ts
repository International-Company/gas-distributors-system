import { api, searchParamsObject } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { listLoginAttempts } from "@/server/services/logs";

export const GET = api(async (req) => listLoginAttempts(await requireApiActor({ role: "ADMIN" }), searchParamsObject(req)));
