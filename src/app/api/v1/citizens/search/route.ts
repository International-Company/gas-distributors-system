import { api, searchParamsObject } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { searchCitizens } from "@/server/services/citizens";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const GET = api(async (req) => searchCitizens(await actor(), searchParamsObject(req)));
