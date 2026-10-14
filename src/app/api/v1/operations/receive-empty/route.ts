import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { receiveEmpty } from "@/server/services/operations";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

/** {clientOpId, entitlementId, nationalId, identityMethod} */
export const POST = api(async (req) => receiveEmpty(await actor(), await readJson(req)));
