import { api, readJson, searchParamsObject } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { createDistributor, listDistributors } from "@/server/services/distributors";

export const GET = api(async (req) => listDistributors(await requireApiActor({ role: "ADMIN" }), searchParamsObject(req)));

export const POST = api(async (req) => createDistributor(await requireApiActor({ role: "ADMIN" }), await readJson(req)));
