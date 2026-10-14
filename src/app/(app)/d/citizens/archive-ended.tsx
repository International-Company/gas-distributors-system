"use client";

import { useRouter } from "next/navigation";
import { Alert, Button, Card } from "@/components/ui";
import { useApi, useFormSubmit } from "@/components/api-client";

export function ArchiveEnded({ count }: { count: number }) {
  const api = useApi();
  const router = useRouter();
  const run = useFormSubmit(() => api("POST", "/api/v1/citizens/archive-ended"), () => router.refresh());
  return (
    <Card title="أرشفة مواطني الدورات المنتهية">
      <p className="mb-3 text-sm text-muted">
        {count} مواطن كل استحقاقاتهم في دورات مغلقة. الأرشفة تخفيهم من البحث الافتراضي فقط؛ لا تحذف بياناتهم أو عملياتهم، ويمكن استعادتهم، ويعودون تلقائيًا إن ظهروا في كشف جديد معتمد.
      </p>
      {run.error && <Alert tone="danger" className="mb-3">{run.error}</Alert>}
      <Button variant="secondary" loading={run.busy} onClick={() => confirm(`أرشفة ${count} مواطن؟`) && run.submit()}>أرشفة {count} مواطن</Button>
    </Card>
  );
}
