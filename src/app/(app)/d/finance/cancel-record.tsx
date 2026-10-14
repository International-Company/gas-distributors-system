"use client";

import { useRouter } from "next/navigation";
import { CancelRecordButton } from "@/components/payment-dialog";

export function CancelRecord({ url }: { url: string }) {
  const router = useRouter();
  return <CancelRecordButton url={url} onDone={() => router.refresh()} />;
}
