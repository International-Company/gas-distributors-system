import { api } from "@/server/http/api";
import { clearSessionCookie, currentSession } from "@/server/http/context";
import { logout } from "@/server/auth/login";

export const POST = api(async () => {
  const s = await currentSession();
  if (s?.actor.sessionId) await logout(s.actor.sessionId);
  await clearSessionCookie();
  return { ok: true };
});
