import { z } from "zod";
import { Prisma } from "@prisma/client";
import { withTenant } from "../db";
import { AppError, notFound } from "../errors";
import { type Actor, assertDistributor } from "../actor";
import { audit } from "../audit";
import { recordMovement, reverseMovement } from "./inventory";
import { cancelOperationInTx, fillInTx } from "./operations";
import { getSettings } from "./settings";

// ---------------------------------------------------------------------------
// المحطات
// ---------------------------------------------------------------------------

const stationSchema = z.object({
  name: z.string().trim().min(2, "اسم المحطة مطلوب").max(100),
  phone: z.string().trim().max(20).optional().nullable().transform((v) => v || null),
  notes: z.string().trim().max(500).optional().nullable().transform((v) => v || null),
  // سعر شراء الجرة الافتراضي من المحطة (يُقترح عند تسجيل الشحنة).
  defaultUnitPrice: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v) => (v === null || v === undefined || v === "" ? null : String(v).replace(/[٫,]/g, ".")))
    .refine((v) => v === null || /^\d{1,8}(\.\d{1,2})?$/.test(v), "سعر غير صالح"),
  active: z.boolean().optional(),
});

export async function listStations(actor: Actor) {
  assertDistributor(actor);
  return withTenant(actor.distributorId, (tx) =>
    tx.station.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], include: { _count: { select: { shipments: true } } } }),
  );
}

export async function createStation(actor: Actor, input: unknown) {
  assertDistributor(actor);
  const v = stationSchema.parse(input);
  return withTenant(actor.distributorId, async (tx) => {
    const s = await tx.station.create({
      data: { distributorId: actor.distributorId, name: v.name, phone: v.phone, notes: v.notes, defaultUnitPrice: v.defaultUnitPrice === null ? null : new Prisma.Decimal(v.defaultUnitPrice) },
    });
    await audit(tx, actor, { action: "station.create", entityType: "station", entityId: s.id, distributorId: actor.distributorId, after: s });
    return s;
  }).catch(dupName);
}

export async function updateStation(actor: Actor, id: string, input: unknown) {
  assertDistributor(actor);
  const v = stationSchema.partial().parse(input);
  return withTenant(actor.distributorId, async (tx) => {
    const before = await tx.station.findUnique({ where: { id } });
    if (!before) throw notFound("المحطة");
    const { defaultUnitPrice, ...rest } = v;
    const after = await tx.station.update({
      where: { id },
      data: { ...rest, ...(defaultUnitPrice !== undefined ? { defaultUnitPrice: defaultUnitPrice === null ? null : new Prisma.Decimal(defaultUnitPrice) } : {}) },
    });
    await audit(tx, actor, { action: "station.update", entityType: "station", entityId: id, distributorId: actor.distributorId, before, after });
    return after;
  }).catch(dupName);
}

function dupName(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new AppError("CONFLICT", "توجد محطة بهذا الاسم", { name: "الاسم مستخدم" });
  throw e;
}

// ---------------------------------------------------------------------------
// الشحنات
// ---------------------------------------------------------------------------

const shipmentSchema = z.object({
  clientOpId: z.string().trim().min(8).max(100),
  stationId: z.string().uuid("اختر المحطة"),
  receivedAt: z.string().optional().transform((v, ctx) => {
    if (!v) return new Date();
    const d = new Date(v);
    if (Number.isNaN(d.getTime()) || d.getTime() > Date.now() + 5 * 60_000) {
      ctx.addIssue({ code: "custom", message: "وقت الاستلام غير صالح" });
      return z.NEVER;
    }
    return d;
  }),
  quantity: z.coerce.number().int().min(1, "عدد الجرار المستلمة مطلوب").max(10_000),
  // سعر شراء الجرة في هذه الشحنة؛ إن غاب يُستخدم السعر الافتراضي للمحطة.
  unitPrice: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v) => (v === null || v === undefined || v === "" ? null : String(v).replace(/[٫,]/g, ".")))
    .refine((v) => v === null || /^\d{1,8}(\.\d{1,2})?$/.test(v), "سعر غير صالح"),
  cylinderIds: z.array(z.string().uuid()).max(10_000).default([]),
  reference: z.string().trim().max(100).optional().nullable().transform((v) => v || null),
  notes: z.string().trim().max(1000).optional().nullable().transform((v) => v || null),
});

/**
 * استلام شحنة معبأة من محطة. الجرار المختارة من الفارغة المستلمة تُعبأ ضمن هذه الشحنة
 * (عملية تعبئة لكل جرة)، والباقي كمية إضافية غير مرتبطة بمواطنين (حركة مستقلة).
 * فلا تُحتسب الجرة مرتين. استلام الشحنة لا يعني دفع قيمتها.
 */
export async function receiveShipment(actor: Actor, input: unknown) {
  assertDistributor(actor);
  const v = shipmentSchema.parse(input);
  const linked = new Set(v.cylinderIds);
  if (linked.size !== v.cylinderIds.length) throw new AppError("VALIDATION", "جرة مكررة في النقلة");
  if (linked.size > v.quantity) throw new AppError("VALIDATION", "عدد جرار المواطنين المختارة أكبر من عدد الجرار المستلمة", { quantity: "العدد أقل من المختار" });
  const find = () => withTenant(actor.distributorId, (tx) => tx.shipment.findUnique({ where: { distributorId_idempotencyKey: { distributorId: actor.distributorId, idempotencyKey: v.clientOpId } } }));
  const existing = await find();
  if (existing) return { id: existing.id, replayed: true };
  try {
    return await withTenant(actor.distributorId, async (tx) => {
      const station = await tx.station.findUnique({ where: { id: v.stationId } });
      if (!station) throw notFound("المحطة");
      if (!station.active) throw new AppError("INVALID_STATE", "المحطة غير نشطة");
      const extra = v.quantity - linked.size;
      const unitPrice = v.unitPrice ?? station.defaultUnitPrice?.toString() ?? null;
      if (unitPrice === null) throw new AppError("VALIDATION", "أدخل سعر شراء الجرة من المحطة لهذه النقلة", { unitPrice: "السعر مطلوب" });
      const settings = await getSettings(tx);
      const sh = await tx.shipment.create({
        data: {
          distributorId: actor.distributorId, stationId: station.id, receivedAt: v.receivedAt, quantity: v.quantity,
          linkedCount: linked.size, extraCount: extra, reference: v.reference, notes: v.notes, idempotencyKey: v.clientOpId, userId: actor.userId,
          unitPrice: new Prisma.Decimal(unitPrice), currencyCode: settings.currencyCode,
        },
      });
      for (const cylinderId of v.cylinderIds) await fillInTx(tx, actor, { clientOpId: `${v.clientOpId}:${cylinderId}`, cylinderId }, sh.id);
      if (extra > 0) await recordMovement(tx, actor, { type: "SHIPMENT_EXTRA", delta: { extra }, shipmentId: sh.id });
      await audit(tx, actor, { action: "shipment.receive", entityType: "shipment", entityId: sh.id, distributorId: actor.distributorId, after: { station: station.name, quantity: v.quantity, linked: linked.size, extra, reference: v.reference, unitPrice, value: new Prisma.Decimal(unitPrice).mul(v.quantity).toFixed(2) } });
      return { id: sh.id, replayed: false };
    }, { timeout: 120_000 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await find();
      if (again) return { id: again.id, replayed: true };
      throw new AppError("CONFLICT", "تعارض: عُبئت إحدى الجرار للتو من جهاز آخر. حدّث الصفحة وأعد المحاولة");
    }
    throw e;
  }
}

/** إلغاء شحنة: تُلغى تعبئاتها (إن لم تُسلّم جرارها) وتُعكس كميتها الإضافية، مرة واحدة. */
export async function cancelShipment(actor: Actor, shipmentId: string, input: unknown) {
  assertDistributor(actor);
  const { reason } = z.object({ reason: z.string().trim().min(3, "يرجى كتابة سبب الإلغاء").max(500) }).parse(input);
  return withTenant(actor.distributorId, async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "shipments" WHERE "id" = ${shipmentId}::uuid FOR UPDATE`;
    if (!locked.length) throw notFound("النقلة");
    const sh = await tx.shipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { fills: { where: { status: "ACTIVE" } } } });
    if (sh.status !== "ACTIVE") throw new AppError("INVALID_STATE", "أُلغيت هذه النقلة سابقًا");
    for (const f of sh.fills) await cancelOperationInTx(tx, actor, f.id, `إلغاء النقلة: ${reason}`, { viaShipment: true });
    if (sh.extraCount > 0) {
      const mv = await tx.inventoryMovement.findFirst({ where: { shipmentId: sh.id, type: "SHIPMENT_EXTRA" } });
      if (mv) await reverseMovement(tx, actor, mv.id, `إلغاء النقلة: ${reason}`);
    }
    await tx.shipment.update({ where: { id: sh.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: reason } });
    await audit(tx, actor, { action: "shipment.cancel", entityType: "shipment", entityId: sh.id, distributorId: actor.distributorId, before: { status: "ACTIVE" }, after: { status: "CANCELLED", reversedFills: sh.fills.length, extra: sh.extraCount }, reason });
  }, { timeout: 120_000 });
}

export async function listShipments(actor: Actor, filters: unknown) {
  assertDistributor(actor);
  const f = z.object({ stationId: z.string().uuid().optional(), page: z.coerce.number().int().min(1).default(1) }).parse(filters ?? {});
  return withTenant(actor.distributorId, async (tx) => {
    const where: Prisma.ShipmentWhereInput = { stationId: f.stationId };
    const [rows, total] = await Promise.all([
      tx.shipment.findMany({ where, include: { station: { select: { name: true } } }, orderBy: { receivedAt: "desc" }, skip: (f.page - 1) * 50, take: 50 }),
      tx.shipment.count({ where }),
    ]);
    return { rows, total, page: f.page, pageSize: 50 };
  });
}

export async function getShipment(actor: Actor, id: string) {
  assertDistributor(actor);
  return withTenant(actor.distributorId, async (tx) => {
    const sh = await tx.shipment.findUnique({
      where: { id },
      include: {
        station: true,
        fills: { include: { cylinder: { include: { entitlement: { select: { nameInStatement: true, cycle: { select: { name: true } } } } } } }, orderBy: { at: "asc" } },
      },
    });
    if (!sh) throw notFound("النقلة");
    return sh;
  });
}
