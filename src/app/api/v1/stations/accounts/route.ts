import { api } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { stationsSummary } from "@/server/services/finance";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const GET = api(async () => stationsSummary(await actor()));
