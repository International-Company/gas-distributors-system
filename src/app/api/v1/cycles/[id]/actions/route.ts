import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { AppError } from "@/server/errors";
import { changeCyclePrice, closeCycle, reopenCycle } from "@/server/services/cycles";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

/** close {confirm} | reopen {reason} | price {unitPrice, reason} */
export const POST = api<{ id: string }>(async (req, { params }) => {
  const body = (await readJson(req)) as { action?: string };
  const a = await actor();
  if (body.action === "close") return closeCycle(a, params.id, body);
  if (body.action === "reopen") return reopenCycle(a, params.id, body);
  if (body.action === "price") return changeCyclePrice(a, params.id, body);
  throw new AppError("VALIDATION", "عملية غير معروفة");
});
