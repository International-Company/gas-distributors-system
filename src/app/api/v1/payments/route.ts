import { api, readJson, searchParamsObject } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { listPayments, recordPayment } from "@/server/services/finance";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const GET = api(async (req) => listPayments(await actor(), searchParamsObject(req)));
/** {clientOpId, entitlementId, full | amount, paidAt?, notes?} */
export const POST = api(async (req) => recordPayment(await actor(), await readJson(req)));
