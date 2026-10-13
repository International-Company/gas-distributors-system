import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { adminAction } from "@/server/services/admins";

/** suspend | activate | reset-password | logout-all | unlock */
export const POST = api<{ id: string }>(async (req, { params }) =>
  adminAction(await requireApiActor({ role: "ADMIN" }), params.id, await readJson(req)),
);
