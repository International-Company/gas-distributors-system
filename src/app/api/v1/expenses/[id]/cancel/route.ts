import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { cancelExpense } from "@/server/services/finance";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const POST = api<{ id: string }>(async (req, { params }) => cancelExpense(await actor(), params.id, await readJson(req)));
