import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { resolveReviewCase } from "@/server/services/citizens";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const POST = api<{ id: string }>(async (req, { params }) => resolveReviewCase(await actor(), params.id, await readJson(req)));
