import { api } from "@/server/http/api";
import { clearDeviceCookie, clearSessionCookie, requireApiActor } from "@/server/http/context";
import { logoutEverywhere } from "@/server/auth/login";

export const POST = api(async () => {
  const actor = await requireApiActor();
  await logoutEverywhere(actor);
  await clearSessionCookie();
  await clearDeviceCookie();
  return { ok: true };
});
