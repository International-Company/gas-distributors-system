import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { discardStatement } from "@/server/services/statements";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const POST = api<{ id: string }>(async (req, { params }) => discardStatement(await actor(), params.id, await readJson(req)));
