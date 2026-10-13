import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { createCategory, listCategories } from "@/server/services/categories";

export const GET = api(async () => listCategories(await requireApiActor({ role: "ADMIN" })));

export const POST = api(async (req) => createCategory(await requireApiActor({ role: "ADMIN" }), await readJson(req)));
