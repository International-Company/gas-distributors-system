import { describe, expect, it } from "vitest";
import {
  applyOverlay, applySyncedToSnapshot, checkDeliver, checkPayment, checkReceive, classifyFailure, fromCents,
  lookupFromSnapshot, nextCylinder, toCents, type Found, type QueuedOp, type Snapshot,
} from "@/lib/offline/logic";

const snap = (): Snapshot => ({
  generatedAt: "2026-10-14T08:00:00.000Z",
  userId: "u1",
  distributorId: "d1",
  currencySymbol: "₪",
  policy: { receive: true, deliver: true, payments: true, maxAgeHours: 24 },
  citizens: [
    {
      citizenId: "c1",
      nationalId: "123456782",
      fullName: "مواطن أول",
      entitlements: [
        {
          id: "e1", cycle: { id: "y2", name: "الدورة 2", status: "OPEN" }, status: "ACTIVE", citizenNumber: "295-7", quantity: 2,
          amountDue: "50.00", paid: "10.00", billable: true,
          cylinders: [{ id: "k1", label: "295-7-1", status: "FILLED", seq: 1 }],
        },
        {
          id: "e0", cycle: { id: "y1", name: "الدورة 1", status: "CLOSED" }, status: "ACTIVE", citizenNumber: "40", quantity: 1,
          amountDue: "25.00", paid: "25.00", billable: true,
          cylinders: [{ id: "k0", label: "40", status: "EMPTY", seq: 1 }],
        },
      ],
    },
  ],
});

const op = (o: Partial<QueuedOp> & Pick<QueuedOp, "kind" | "meta">): QueuedOp => ({
  id: "op1", userId: "u1", createdAt: "2026-10-14T09:00:00.000Z", status: "local", offline: true, snapshotAt: null, attempts: 0, payload: {}, ...o,
});
const found = (l: ReturnType<typeof lookupFromSnapshot>) => l as Found;

describe("البحث من بيانات الجهاز", () => {
  it("يحسب المتبقي والقدرة على الاستلام والتحصيل بقواعد الخادم", () => {
    const l = found(lookupFromSnapshot(snap(), "123456782"));
    expect(l.citizen.fullName).toBe("مواطن أول");
    const [e1, e0] = l.entitlements;
    expect(e1).toMatchObject({ remaining: 1, canReceive: true, amountRemaining: "40.00", canPay: true });
    expect(e0).toMatchObject({ remaining: 0, canReceive: false, amountRemaining: "0.00", canPay: false });
    expect(l.totalRemaining).toBe("40.00");
    expect(lookupFromSnapshot(snap(), "000000000")).toEqual({ found: false, nationalId: "000000000" });
  });

  it("رقم الجرة التالية كما يحسبه الخادم", () => {
    const e1 = found(lookupFromSnapshot(snap(), "123456782")).entitlements[0];
    expect(nextCylinder(e1)).toEqual({ seq: 2, label: "295-7-2" });
  });
});

describe("العمليات غير المتزامنة تُطبق على العرض فلا تتكرر", () => {
  const meta = { nationalId: "123456782", name: "مواطن أول", cycleName: "الدورة 2", entitlementId: "e1" };

  it("استلام معلق: تظهر الجرة ويختفي زر الاستلام", () => {
    const l = found(applyOverlay(lookupFromSnapshot(snap(), "123456782"), [op({ kind: "receive", meta: { ...meta, label: "295-7-2", seq: 2 } })]));
    const e1 = l.entitlements[0];
    expect(e1.cylinders.map((c) => [c.label, c.status, Boolean(c.local)])).toEqual([["295-7-1", "FILLED", false], ["295-7-2", "EMPTY", true]]);
    expect(e1.canReceive).toBe(false);
    expect(checkReceive(e1)).toMatch(/استُلمت كل/);
  });

  it("الاستلام المعلق الذي وصل الخادم فعلًا لا يُكرر في العرض", () => {
    const s = snap();
    s.citizens[0].entitlements[0].cylinders.push({ id: "k2", label: "295-7-2", status: "EMPTY", seq: 2 });
    const l = found(applyOverlay(lookupFromSnapshot(s, "123456782"), [op({ kind: "receive", status: "pending", meta: { ...meta, label: "295-7-2", seq: 2 } })]));
    expect(l.entitlements[0].cylinders).toHaveLength(2);
  });

  it("تسليم معلق: الجرة «سُلّمت» محليًا ولا يمكن تسليمها مرة أخرى من الجهاز", () => {
    const l = found(applyOverlay(lookupFromSnapshot(snap(), "123456782"), [op({ kind: "deliver", meta: { ...meta, cylinderId: "k1", label: "295-7-1" } })]));
    const c = l.entitlements[0].cylinders[0];
    expect(c.status).toBe("DELIVERED");
    expect(checkDeliver(c, "295-7-1")).toMatch(/تنتظر المزامنة/);
  });

  it("تحصيل معلق يُخصم من المتبقي، فلا يتجاوز تحصيل جديد المتبقي", () => {
    const l = found(applyOverlay(lookupFromSnapshot(snap(), "123456782"), [op({ kind: "payment", meta: { ...meta, amount: "30" } })]));
    const e1 = l.entitlements[0];
    expect(e1.paid).toBe("40.00");
    expect(e1.amountRemaining).toBe("10.00");
    expect(checkPayment(e1, "10.01")).toMatch(/يتجاوز/);
    expect(checkPayment(e1, "١٠")).toBeNull();
    expect(l.totalRemaining).toBe("10.00");
  });

  it("العمليات المتزامنة أو المرفوضة لا تُطبق", () => {
    const base = lookupFromSnapshot(snap(), "123456782");
    const out = applyOverlay(base, [
      op({ kind: "payment", status: "synced", meta: { ...meta, amount: "30" } }),
      op({ id: "op2", kind: "deliver", status: "review", meta: { ...meta, cylinderId: "k1" } }),
    ]);
    expect(out).toBe(base);
  });
});

describe("التحقق المحلي للتسليم", () => {
  it("يتطلب جرة معبأة ورقمًا مطابقًا", () => {
    expect(checkDeliver({ id: "k", label: "295-7-1", status: "FILLED", seq: 1 }, "٢٩٥-٧-١")).toBeNull();
    expect(checkDeliver({ id: "k", label: "295-7-1", status: "FILLED", seq: 1 }, "295-7-2")).toMatch(/لا يطابق/);
    expect(checkDeliver({ id: "k", label: "40", status: "EMPTY", seq: 1 }, "40")).toMatch(/غير جاهزة/);
    expect(checkDeliver({ id: "k", label: "40", status: "DELIVERED", seq: 1 }, "40")).toMatch(/سابقًا/);
  });
});

describe("المزامنة", () => {
  it("تصنيف الفشل: العطل المؤقت يُعاد، ورفض العملية مراجعة", () => {
    expect(classifyFailure("NETWORK", 0)).toBe("retry");
    expect(classifyFailure("INTERNAL", 502)).toBe("retry");
    expect(classifyFailure("UNAUTHENTICATED", 401)).toBe("retry");
    expect(classifyFailure("RATE_LIMITED", 429)).toBe("retry");
    expect(classifyFailure("INVALID_STATE", 409)).toBe("reject");
    expect(classifyFailure("VALIDATION", 400)).toBe("reject");
    expect(classifyFailure("NOT_FOUND", 404)).toBe("reject");
  });

  it("تأكيد الخادم يُحدّث لقطة الجهاز", () => {
    const meta = { nationalId: "123456782", name: "x", cycleName: "y", entitlementId: "e1" };
    let s = applySyncedToSnapshot(snap(), op({ kind: "receive", status: "synced", meta, result: { cylinder: { id: "k9", label: "295-7-2", status: "EMPTY" } } }));
    s = applySyncedToSnapshot(s, op({ kind: "deliver", status: "synced", meta: { ...meta, cylinderId: "k1" } }));
    s = applySyncedToSnapshot(s, op({ kind: "payment", status: "synced", meta, result: { paid: "35.00" } }));
    const e1 = s.citizens[0].entitlements[0];
    expect(e1.cylinders.map((c) => [c.id, c.status, c.seq])).toEqual([["k1", "DELIVERED", 1], ["k9", "EMPTY", 2]]);
    expect(e1.paid).toBe("35.00");
  });

  it("حساب المال بالقروش", () => {
    expect(toCents("12.5")).toBe(1250);
    expect(toCents("0.07")).toBe(7);
    expect(fromCents(1250)).toBe("12.50");
    expect(fromCents(-5)).toBe("-0.05");
  });
});
