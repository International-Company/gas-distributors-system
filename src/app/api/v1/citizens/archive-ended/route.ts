import { api } from "@/server/http/api";
import { requireApiActor } from "@/server/http/context";
import { archiveEndedCycleCitizens, countArchivable } from "@/server/services/citizens";

const actor = () => requireApiActor({ role: "DISTRIBUTOR" });

export const GET = api(async () => ({ count: await countArchivable(await actor()) }));
export const POST = api(async () => ({ archived: await archiveEndedCycleCitizens(await actor()) }));
