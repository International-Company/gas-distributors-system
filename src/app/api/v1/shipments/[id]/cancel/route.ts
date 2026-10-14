import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { cancelShipment } from "@/server/services/shipments";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const POST = api<{ id: string }>(async (req, { params }) => cancelShipment(await actor(), params.id, await readJson(req)));
