import { api } from "@/server/http/api";
import { currentSession, getDeviceToken } from "@/server/http/context";
import { AppError } from "@/server/errors";

export const GET = api(async () => {
  const s = await currentSession();
  if (!s) throw new AppError("UNAUTHENTICATED", "غير مسجل الدخول");
  const { actor } = s;
  return {
    userId: actor.userId,
    username: actor.username,
    displayName: actor.displayName,
    role: actor.role,
    isSuperAdmin: actor.isSuperAdmin,
    permissions: actor.permissions,
    authMethod: actor.authMethod,
    mustChangePassword: s.mustChangePassword,
    hasDevicePin: Boolean(await getDeviceToken()),
  };
});
