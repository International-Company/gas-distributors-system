import { api, searchParamsObject } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { cashBox } from "@/server/services/finance";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

/** ?from=&to=&cycleId= — الرصيد محسوب ولا يثبت النقد الفعلي */
export const GET = api(async (req) => cashBox(await actor(), searchParamsObject(req)));
