import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { createStationPayment } from "@/server/services/finance";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

/** {clientOpId, stationId, amount, paidAt?, reference?, notes?} */
export const POST = api(async (req) => createStationPayment(await actor(), await readJson(req)));
