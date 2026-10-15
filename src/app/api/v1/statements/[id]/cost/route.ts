import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { setStatementCost } from "@/server/services/statements";

/** سعر الجرة على الموزّع في الكشف: {costPrice} (أو null لمسحه). */
export const PUT = api<{ id: string }>(async (req, { params }) => setStatementCost(await requireApiActor({ role: "DISTRIBUTOR" }), params.id, await readJson(req)));
