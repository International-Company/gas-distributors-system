import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { createCycle, listCycles } from "@/server/services/cycles";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const GET = api(async () => listCycles(await actor()));
export const POST = api(async (req) => createCycle(await actor(), await readJson(req)));
