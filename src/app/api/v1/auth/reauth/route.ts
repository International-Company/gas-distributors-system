import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { reauthenticate } from "@/server/auth/login";

export const POST = api(async (req) => {
  const actor = await requireApiActor();
  await reauthenticate(actor, await readJson(req));
  return { ok: true };
});
