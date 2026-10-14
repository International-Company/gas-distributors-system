import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { dismissMergeSuggestion, mergeSuggestions } from "@/server/services/citizens";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const GET = api(async () => mergeSuggestions(await actor()));
/** رفض اقتراح: {citizenAId, citizenBId} */
export const POST = api(async (req) => dismissMergeSuggestion(await actor(), await readJson(req)));
