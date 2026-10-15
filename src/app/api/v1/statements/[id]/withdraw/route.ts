import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { withdrawStatement } from "@/server/services/statements";

/** حذف كشف معتمد اعتُمد بالخطأ: {reason} */
export const POST = api<{ id: string }>(async (req, { params }) => withdrawStatement(await requireApiActor({ role: "DISTRIBUTOR" }), params.id, await readJson(req)));
