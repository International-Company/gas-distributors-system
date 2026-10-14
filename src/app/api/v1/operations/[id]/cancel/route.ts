import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { cancelOperation } from "@/server/services/operations";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const POST = api<{ id: string }>(async (req, { params }) => cancelOperation(await actor(), params.id, await readJson(req)));
