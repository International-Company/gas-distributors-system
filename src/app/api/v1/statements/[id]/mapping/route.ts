import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { updateMapping } from "@/server/services/statements";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const PUT = api<{ id: string }>(async (req, { params }) => updateMapping(await actor(), params.id, await readJson(req)));
