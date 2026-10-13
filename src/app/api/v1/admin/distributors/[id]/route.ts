import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { getDistributor, updateDistributor } from "@/server/services/distributors";

type P = { id: string };

export const GET = api<P>(async (_req, { params }) => getDistributor(await requireApiActor({ role: "ADMIN" }), params.id));

export const PATCH = api<P>(async (req, { params }) =>
  updateDistributor(await requireApiActor({ role: "ADMIN" }), params.id, await readJson(req)),
);
