import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { mergeCitizens } from "@/server/services/citizens";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const POST = api(async (req) => mergeCitizens(await actor(), await readJson(req)));
