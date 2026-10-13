import { redirect } from "next/navigation";
import { requirePageActor } from "@/server/http/context";

export default async function Home() {
  const actor = await requirePageActor();
  redirect(actor.role === "ADMIN" ? "/admin" : "/d");
}
