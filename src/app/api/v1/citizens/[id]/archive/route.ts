import { api, readJson } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { z } from "zod";
import { setCitizenArchived } from "@/server/services/citizens";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

/** {archived: true} أرشفة، {archived: false} استعادة */
export const POST = api<{ id: string }>(async (req, { params }) => {
  const { archived } = z.object({ archived: z.boolean() }).parse(await readJson(req));
  return setCitizenArchived(await actor(), params.id, archived);
});
