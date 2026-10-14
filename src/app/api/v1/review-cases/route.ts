import { api, readJson, searchParamsObject } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { createReviewCase, listReviewCases } from "@/server/services/citizens";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const GET = api(async (req) => listReviewCases(await actor(), searchParamsObject(req)));
export const POST = api(async (req) => createReviewCase(await actor(), await readJson(req)));
