import { api } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { getCylinder } from "@/server/services/operations";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const GET = api<{ id: string }>(async (_req, { params }) => getCylinder(await actor(), params.id));
