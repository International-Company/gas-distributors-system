import { api, searchParamsObject } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { counterLookup } from "@/server/services/operations";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

/** الشباك: رقم الهوية من البطاقة ← استحقاقات المواطن وجراره. */
export const GET = api(async (req) => counterLookup(await actor(), searchParamsObject(req)));
