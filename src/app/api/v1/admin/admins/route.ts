import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { createAdmin, listAdmins } from "@/server/services/admins";

export const GET = api(async () => listAdmins(await requireApiActor({ role: "ADMIN" })));

export const POST = api(async (req) => createAdmin(await requireApiActor({ role: "ADMIN" }), await readJson(req)));
