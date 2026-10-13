import { api } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { getOwnDistributor } from "@/server/services/distributors";

export const GET = api(async () => getOwnDistributor(await requireApiActor({ role: "DISTRIBUTOR" })));
