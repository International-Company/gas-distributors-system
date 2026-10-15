import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { startNextCycle } from "@/server/services/cycles";

/** ابدأ دورة جديدة: تُغلق الحالية وتُفتح التالية. {name?} */
export const POST = api(async (req) => startNextCycle(await requireApiActor({ role: "DISTRIBUTOR" }), await readJson(req)));
