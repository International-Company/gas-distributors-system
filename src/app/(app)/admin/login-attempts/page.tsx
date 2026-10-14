import { requirePageActor } from "@/server/http/context";
import { listLoginAttempts } from "@/server/services/logs";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { Pagination } from "@/components/pagination";
import { formatDateTime } from "@/lib/format";
import { DateInput } from "@/components/date-input";

export const metadata = { title: "مين دخل" };

const REASONS: Record<string, string> = {
  UNKNOWN_USER: "مستخدم غير موجود",
  BAD_PASSWORD: "كلمة مرور خاطئة",
  BAD_PASSWORD_LOCKED: "كلمة مرور خاطئة وقُفل الحساب",
  LOCKED: "الحساب مقفل مؤقتًا",
  ACCOUNT_BLOCKED: "الحساب معلّق أو منتهي أو مؤرشف",
  BAD_PIN: "PIN خاطئ",
  BAD_PIN_REVOKED: "PIN خاطئ وأُلغي",
  REAUTH_BAD_PASSWORD: "فشل تأكيد كلمة المرور",
};

export default async function LoginAttemptsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor({ role: "ADMIN", permission: "audit.view" });
  const sp = await searchParams;
  const params = Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && k !== "page")) as Record<string, string>;
  const data = await listLoginAttempts(actor, { ...params, page: sp.page });
  return (
    <div>
      <PageHeader title="مين دخل" />
      <form method="get" className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface p-3 md:grid-cols-5">
        <Input name="username" defaultValue={sp.username} placeholder="اسم المستخدم" dir="ltr" />
        <Select name="success" defaultValue={sp.success ?? ""} aria-label="النتيجة">
          <option value="">كل النتائج</option>
          <option value="yes">ناجحة</option>
          <option value="no">فاشلة</option>
        </Select>
        <DateInput name="from" defaultValue={sp.from} aria-label="من تاريخ" />
        <DateInput name="to" defaultValue={sp.to} aria-label="إلى تاريخ" />
        <Button type="submit" className="col-span-2 md:col-span-1">تطبيق</Button>
      </form>
      <Card>
        {data.rows.length === 0 ? (
          <EmptyState>لا توجد محاولات.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-right text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="py-2 font-medium">الوقت</th>
                  <th className="py-2 font-medium">اسم المستخدم</th>
                  <th className="py-2 font-medium">الطريقة</th>
                  <th className="py-2 font-medium">النتيجة</th>
                  <th className="py-2 font-medium">عنوان IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.rows.map((r) => (
                  <tr key={String(r.id)}>
                    <td className="py-2 ltr-nums">{formatDateTime(r.createdAt)}</td>
                    <td className="py-2 ltr-nums">{r.username}</td>
                    <td className="py-2">{r.method === "PIN" ? "PIN" : "كلمة المرور"}</td>
                    <td className="py-2">
                      {r.success ? <Badge tone="success">ناجحة</Badge> : <Badge tone="danger">{REASONS[r.reason ?? ""] ?? "فاشلة"}</Badge>}
                    </td>
                    <td className="py-2 ltr-nums">{r.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={data.page} total={data.total} pageSize={data.pageSize} base="/admin/login-attempts" params={params} />
      </Card>
    </div>
  );
}
