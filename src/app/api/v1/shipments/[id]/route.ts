import { api } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { getShipment } from "@/server/services/shipments";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const GET = api<{ id: string }>(async (_req, { params }) => getShipment(await actor(), params.id));
