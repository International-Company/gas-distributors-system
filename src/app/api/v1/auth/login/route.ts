import { api, readJson } from "@/server/http/api";
import { clientInfo, setSessionCookie } from "@/server/http/context";
import { loginWithPassword } from "@/server/auth/login";

export const POST = api(async (req) => {
  const { token, mustChangePassword } = await loginWithPassword(await readJson(req), await clientInfo());
  await setSessionCookie(token);
  return { mustChangePassword };
});
