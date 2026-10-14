import { api, searchParamsObject } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { centralOverview } from "@/server/reports/service";

export const GET = api(async (req) => centralOverview(await requireApiActor({ role: "ADMIN" }), searchParamsObject(req)));
