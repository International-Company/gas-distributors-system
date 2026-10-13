import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { deleteCategory, renameCategory } from "@/server/services/categories";

type P = { id: string };

export const PATCH = api<P>(async (req, { params }) =>
  renameCategory(await requireApiActor({ role: "ADMIN" }), params.id, await readJson(req)),
);

export const DELETE = api<P>(async (_req, { params }) => deleteCategory(await requireApiActor({ role: "ADMIN" }), params.id));
