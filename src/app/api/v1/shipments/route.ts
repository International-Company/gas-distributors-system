import { api, readJson, searchParamsObject } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { listShipments, receiveShipment } from "@/server/services/shipments";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const GET = api(async (req) => listShipments(await actor(), searchParamsObject(req)));
/** {clientOpId, stationId, receivedAt?, quantity, cylinderIds[], reference?, notes?} */
export const POST = api(async (req) => receiveShipment(await actor(), await readJson(req)));
