import { api, searchParamsObject } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { listMovements } from "@/server/services/inventory";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const GET = api(async (req) => listMovements(await actor(), searchParamsObject(req)));
