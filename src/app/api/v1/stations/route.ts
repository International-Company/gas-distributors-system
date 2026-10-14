import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { createStation, listStations } from "@/server/services/shipments";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const GET = api(async () => listStations(await actor()));
export const POST = api(async (req) => createStation(await actor(), await readJson(req)));
