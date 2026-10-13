import { api } from "@/server/http/api";
import { getPublicSettings } from "@/server/services/settings";

export const GET = api(async () => getPublicSettings());
