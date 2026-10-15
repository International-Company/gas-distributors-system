import { api, searchParamsObject } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { sheet } from "@/server/services/sheet";

/** «الكشف»: ناس الكشف المختار (?statementId=) وحالة كل شخص. */
export const GET = api(async (req) => sheet(await requireApiActor({ role: "DISTRIBUTOR" }), searchParamsObject(req)));
