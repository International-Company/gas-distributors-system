import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { changeOwnPassword } from "@/server/auth/login";

export const POST = api(async (req) => {
  const actor = await requireApiActor({ allowPasswordChange: true });
  await changeOwnPassword(actor, await readJson(req));
  return { ok: true };
});
