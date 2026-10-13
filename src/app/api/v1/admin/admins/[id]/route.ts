import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { getAdmin, updateAdmin } from "@/server/services/admins";

type P = { id: string };

export const GET = api<P>(async (_req, { params }) => getAdmin(await requireApiActor({ role: "ADMIN" }), params.id));

export const PATCH = api<P>(async (req, { params }) =>
  updateAdmin(await requireApiActor({ role: "ADMIN" }), params.id, await readJson(req)),
);
