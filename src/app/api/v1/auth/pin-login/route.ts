import { api, readJson } from "@/server/http/api";
import { clientInfo, getDeviceToken, setSessionCookie } from "@/server/http/context";
import { loginWithPin } from "@/server/auth/login";

export const POST = api(async (req) => {
  const { token } = await loginWithPin(await readJson(req), await getDeviceToken(), await clientInfo());
  await setSessionCookie(token);
  return { ok: true };
});
