import { api, searchParamsObject } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { stationAccount } from "@/server/services/finance";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const GET = api<{ id: string }>(async (req, { params }) => stationAccount(await actor(), params.id, searchParamsObject(req)));
