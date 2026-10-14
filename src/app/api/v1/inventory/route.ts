import { api } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { getInventory } from "@/server/services/inventory";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const GET = api(async () => getInventory(await actor()));
