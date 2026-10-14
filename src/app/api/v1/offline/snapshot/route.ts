import { api } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { offlineSnapshot } from "@/server/services/offline";

/** لقطة الشباك للعمل دون اتصال (للموزّع فقط، تُسجل في التدقيق). */
export const GET = api(async () => offlineSnapshot(await requireApiActor({ role: "DISTRIBUTOR" })));
