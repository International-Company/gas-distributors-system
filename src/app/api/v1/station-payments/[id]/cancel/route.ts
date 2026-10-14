import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { cancelStationPayment } from "@/server/services/finance";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const POST = api<{ id: string }>(async (req, { params }) => cancelStationPayment(await actor(), params.id, await readJson(req)));
