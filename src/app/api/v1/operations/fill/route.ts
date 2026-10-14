import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { fillCylinders } from "@/server/services/operations";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

/** {items: [{clientOpId, cylinderId}]} — كلها أو لا شيء */
export const POST = api(async (req) => fillCylinders(await actor(), await readJson(req)));
