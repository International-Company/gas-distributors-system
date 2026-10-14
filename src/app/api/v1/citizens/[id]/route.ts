import { api } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { getCitizenProfile } from "@/server/services/citizens";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const GET = api<{ id: string }>(async (_req, { params }) => getCitizenProfile(await actor(), params.id));
