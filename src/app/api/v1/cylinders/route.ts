import { api, searchParamsObject } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { listCylinders } from "@/server/services/operations";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const GET = api(async (req) => listCylinders(await actor(), searchParamsObject(req)));
