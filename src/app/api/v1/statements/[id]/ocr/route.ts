import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { submitOcr } from "@/server/services/statements";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const POST = api<{ id: string }>(async (req, { params }) => submitOcr(await actor(), params.id, await readJson(req)));
