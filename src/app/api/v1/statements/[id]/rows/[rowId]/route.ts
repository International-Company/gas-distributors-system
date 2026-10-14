import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { updateRow } from "@/server/services/statements";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const PATCH = api<{ id: string; rowId: string }>(async (req, { params }) => updateRow(await actor(), params.id, params.rowId, await readJson(req)));
