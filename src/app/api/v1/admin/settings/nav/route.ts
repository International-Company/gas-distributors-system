import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { updateNavOverrides } from "@/server/services/settings";

export const PUT = api(async (req) => updateNavOverrides(await requireApiActor({ role: "ADMIN" }), await readJson(req)));
