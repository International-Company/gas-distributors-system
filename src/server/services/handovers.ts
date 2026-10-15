import { z } from "zod";
import { Prisma, type Handover } from "@prisma/client";
import { withTenant } from "../db";
import { AppError, notFound } from "../errors";
import { type Actor, assertDistributor } from "../actor";
import { audit } from "../audit";
import { digitsOnly } from "@/lib/arabic";
import { IdentityMismatch, recordIdentityCase, verifyIdentity } from "./operations";
import { assertOfflineAllowed, offlineAtSchema, withOfflineConflict } from "./offline";

// ---------------------------------------------------------------------------
// التسليم المبسّط (قرار المالك): «سلّم» واحد لكل استحقاق، بعد التحقق من الهوية.
// لا مراحل فارغة/معبأة ولا أرقام جرار. تسليم نافذ واحد فقط لكل استحقاق (قيد في قاعدة البيانات).
// ---------------------------------------------------------------------------

const handoverSchema = z.object({
  clientOpId: z.string().trim().min(8, "معرّف العملية مطلوب").max(100),
  entitlementId: z.string().uuid(),
  nationalId: z.string().trim().min(1, "أدخل رقم الهوية من البطاقة"),
  identityMethod: z.enum(["MANUAL_ENTRY", "ID_SCAN"]).default("MANUAL_ENTRY"),
  offlineAt: offlineAtSchema,
  snapshotAt: offlineAtSchema,
});

const result = (h: Handover, replayed: boolean) => ({ replayed, handoverId: h.id, entitlementId: h.entitlementId, quantity: h.quantity, at: h.at });

export async function handOver(actor: Actor, input: unknown) {
  assertDistributor(actor);
  const v = handoverSchema.parse(input);
  const find = () =>
    withTenant(actor.distributorId, (tx) => tx.handover.findUnique({ where: { distributorId_idempotencyKey: { distributorId: actor.distributorId, idempotencyKey: v.clientOpId } } }));
  const replay = (h: Handover | null) => {
    if (!h) return null;
    if (h.entitlementId !== v.entitlementId) throw new AppError("CONFLICT", "معرّف العملية مستخدم لعملية أخرى");
    return result(h, true);
  };
  const op = { id: v.clientOpId, kind: "deliver" as const, nationalId: digitsOnly(v.nationalId), offlineAt: v.offlineAt, summary: "تسليم" };

  return withOfflineConflict(actor, op, async () => {
    const prior = replay(await find());
    if (prior) return prior;
    await assertOfflineAllowed("deliver", v.offlineAt, v.snapshotAt);
    try {
      return await withTenant(actor.distributorId, async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "entitlements" WHERE "id" = ${v.entitlementId}::uuid FOR UPDATE`;
        if (!locked.length) throw notFound("الاستحقاق");
        // طلب مكرر وصل متزامنًا ينتظر القفل ثم يجد الأول قد نُفذ.
        const dup = replay(await tx.handover.findUnique({ where: { distributorId_idempotencyKey: { distributorId: actor.distributorId, idempotencyKey: v.clientOpId } } }));
        if (dup) return dup;
        const e = await tx.entitlement.findUniqueOrThrow({
          where: { id: v.entitlementId },
          include: {
            citizen: true,
            statement: { select: { status: true } },
            cylinders: { where: { status: { not: "VOID" } }, select: { id: true } },
            handovers: { where: { status: "ACTIVE" }, select: { id: true } },
          },
        });
        verifyIdentity(v.nationalId, e.citizen);
        if (e.status !== "ACTIVE") throw new AppError("INVALID_STATE", "هذا الشخص أُزيل من الكشف المعتمد");
        if (!["APPROVED", "SUPERSEDED"].includes(e.statement.status)) throw new AppError("INVALID_STATE", "الكشف غير معتمد");
        if (e.handovers.length) throw new AppError("INVALID_STATE", "سُلّم هذا الشخص سابقًا");
        if (e.cylinders.length) throw new AppError("INVALID_STATE", "لهذا الشخص جرار مسجّلة بالطريقة السابقة (مراحل)؛ يُكمَل تسليمها من صفحة الجرار");
        const h = await tx.handover.create({
          data: {
            distributorId: actor.distributorId, entitlementId: e.id, quantity: e.quantity, idempotencyKey: v.clientOpId,
            identityMethod: v.identityMethod, offlineAt: v.offlineAt, userId: actor.userId,
          },
        });
        await audit(tx, actor, {
          action: "handover.create", entityType: "handover", entityId: h.id, distributorId: actor.distributorId,
          after: { entitlementId: e.id, quantity: e.quantity, citizen: e.citizen.nationalId, offlineAt: v.offlineAt?.toISOString() ?? null },
        });
        return result(h, false);
      });
    } catch (err) {
      if (err instanceof IdentityMismatch) await recordIdentityCase(actor, err, "تسليم");
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const again = replay(await find());
        if (again) return again;
        throw new AppError("INVALID_STATE", "سُلّم هذا الشخص للتو من جهاز آخر");
      }
      throw err;
    }
  });
}

/** إلغاء تسليم سُجل بالخطأ: لا يُحذف، يُعلَّم «ملغى» مع السبب ويبقى في السجل. */
export async function cancelHandover(actor: Actor, handoverId: string, input: unknown) {
  assertDistributor(actor);
  const { reason } = z.object({ reason: z.string().trim().min(3, "يرجى كتابة سبب الإلغاء").max(500) }).parse(input);
  return withTenant(actor.distributorId, async (tx) => {
    const h = await tx.handover.findUnique({ where: { id: handoverId } });
    if (!h) throw notFound("التسليم");
    const res = await tx.handover.updateMany({
      where: { id: h.id, status: "ACTIVE" },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: reason },
    });
    if (res.count !== 1) throw new AppError("INVALID_STATE", "أُلغي هذا التسليم سابقًا");
    await audit(tx, actor, {
      action: "handover.cancel", entityType: "handover", entityId: h.id, distributorId: actor.distributorId,
      before: { status: "ACTIVE", entitlementId: h.entitlementId }, after: { status: "CANCELLED" }, reason,
    });
  });
}
