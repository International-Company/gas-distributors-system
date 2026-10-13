import { api, readJson } from "@/server/http/api";
import { clearDeviceCookie, getDeviceToken, requireApiActor, setDeviceCookie } from "@/server/http/context";
import { removeDevicePin, setDevicePin } from "@/server/auth/login";

/** تفعيل PIN على هذا الجهاز (يتطلب كلمة المرور). */
export const POST = api(async (req) => {
  const actor = await requireApiActor();
  const token = await setDevicePin(actor, await readJson(req), await getDeviceToken());
  await setDeviceCookie(token);
  return { ok: true };
});

/** إلغاء PIN هذا الجهاز. */
export const DELETE = api(async () => {
  const actor = await requireApiActor();
  await removeDevicePin(actor, await getDeviceToken());
  await clearDeviceCookie();
  return { ok: true };
});
