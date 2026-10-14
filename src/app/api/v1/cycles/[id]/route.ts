import { api } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { getCycleSummary } from "@/server/services/cycles";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const GET = api<{ id: string }>(async (_req, { params }) => getCycleSummary(await actor(), params.id));
