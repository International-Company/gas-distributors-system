import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { editEntitlement } from "@/server/services/citizens";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const PATCH = api<{ id: string }>(async (req, { params }) => editEntitlement(await actor(), params.id, await readJson(req)));
