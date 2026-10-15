import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { handOver } from "@/server/services/handovers";

/** «سلّم»: {clientOpId, entitlementId, nationalId, identityMethod, offlineAt?, snapshotAt?} */
export const POST = api(async (req) => handOver(await requireApiActor({ role: "DISTRIBUTOR" }), await readJson(req)));
