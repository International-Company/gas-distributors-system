import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { updateStation } from "@/server/services/shipments";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const PATCH = api<{ id: string }>(async (req, { params }) => updateStation(await actor(), params.id, await readJson(req)));
