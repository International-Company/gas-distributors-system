import { api, readJson, searchParamsObject } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { createExpense, listExpenses } from "@/server/services/finance";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const GET = api(async (req) => listExpenses(await actor(), searchParamsObject(req)));
/** {clientOpId, amount, description, spentAt?} */
export const POST = api(async (req) => createExpense(await actor(), await readJson(req)));
