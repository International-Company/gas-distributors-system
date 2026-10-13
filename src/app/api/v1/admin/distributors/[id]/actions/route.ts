import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { distributorAction } from "@/server/services/distributors";

/** عمليات دورة حياة الحساب: suspend | activate | set-validity | archive | unarchive | pin | unpin | reset-password | logout-all | unlock */
export const POST = api<{ id: string }>(async (req, { params }) =>
  distributorAction(await requireApiActor({ role: "ADMIN" }), params.id, await readJson(req)),
);
