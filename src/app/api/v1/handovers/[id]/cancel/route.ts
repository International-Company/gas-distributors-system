import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { cancelHandover } from "@/server/services/handovers";

/** إلغاء تسليم سُجل بالخطأ: {reason} */
export const POST = api<{ id: string }>(async (req, { params }) => cancelHandover(await requireApiActor({ role: "DISTRIBUTOR" }), params.id, await readJson(req)));
