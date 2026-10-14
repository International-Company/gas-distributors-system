import { api, readJson, searchParamsObject } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { getStatement, updateStatementMeta } from "@/server/services/statements";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

type P = { id: string };
export const GET = api<P>(async (req, { params }) => getStatement(await actor(), params.id, searchParamsObject(req)));
export const PATCH = api<P>(async (req, { params }) => updateStatementMeta(await actor(), params.id, await readJson(req)));
