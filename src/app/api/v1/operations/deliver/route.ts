import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { deliverCylinder } from "@/server/services/operations";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

/** {clientOpId, cylinderId, cylinderLabel, nationalId, identityMethod} */
export const POST = api(async (req) => deliverCylinder(await actor(), await readJson(req)));
