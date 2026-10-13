import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { getSettings, updateSettings } from "@/server/services/settings";
import { withSystem } from "@/server/db";

export const GET = api(async () => {
  await requireApiActor({ role: "ADMIN", permission: "settings.manage" });
  return withSystem(getSettings);
});

export const PATCH = api(async (req) => updateSettings(await requireApiActor({ role: "ADMIN" }), await readJson(req)));
