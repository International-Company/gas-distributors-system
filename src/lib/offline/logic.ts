// منطق العمل دون اتصال، بلا أي اعتماد على المتصفح (قابل للاختبار مباشرة).
import { cylinderLabel, normalizeLabel } from "../cylinder-label";

// ---------------------------------------------------------------------------
// الأنواع: شكل نتيجة بحث الشباك (من الخادم أو من بيانات الجهاز)، ولقطة الجهاز، وقائمة الانتظار
// ---------------------------------------------------------------------------

export type CylStatus = "EMPTY" | "FILLED" | "DELIVERED" | "VOID";
export type Cyl = { id: string; label: string; status: CylStatus; seq: number; local?: boolean };
export type Ent = {
  id: string;
  cycle: { id: string; name: string; status: string };
  status: string;
  citizenNumber: string;
  quantity: number;
  amountDue: string;
  cylinders: Cyl[];
  remaining: number;
  canReceive: boolean;
  paid: string;
  amountRemaining: string;
  canPay: boolean;
};
export type Found = {
  found: true;
  nationalId: string;
  citizen: { id: string; fullName: string; phone: string | null };
  totalRemaining: string;
  entitlements: Ent[];
};
export type Lookup = { found: false; nationalId: string } | Found;

export type Policy = { receive: boolean; deliver: boolean; payments: boolean; maxAgeHours: number };
export type Snapshot = {
  generatedAt: string;
  userId: string;
  distributorId: string;
  currencySymbol: string;
  policy: Policy;
  citizens: {
    citizenId: string;
    nationalId: string;
    fullName: string;
    entitlements: { id: string; cycle: Ent["cycle"]; status: string; citizenNumber: string; quantity: number; amountDue: string; paid: string; billable: boolean; cylinders: Cyl[] }[];
  }[];
};

export type OpKind = "receive" | "deliver" | "payment";
/**
 * local: محفوظة على الجهاز ولم تُرسل بعد. pending: أُرسلت ولم يصل تأكيد الخادم (تُعاد بأمان بمعرّفها).
 * synced: أكدها الخادم. review: رفضها الخادم وتحتاج مراجعة (لا تُحسم تلقائيًا).
 */
export type OpStatus = "local" | "pending" | "synced" | "review";
export type QueuedOp = {
  id: string;
  kind: OpKind;
  userId: string;
  createdAt: string;
  status: OpStatus;
  /** نُفذت دون تأكيد فوري من الخادم: تُرسل بوقت تنفيذها على الجهاز، ورفضها يصبح حالة مراجعة. */
  offline: boolean;
  /** وقت لقطة البيانات التي اعتمد عليها التنفيذ دون اتصال. */
  snapshotAt: string | null;
  attempts: number;
  lastError?: string;
  lastTriedAt?: string;
  syncedAt?: string;
  dismissed?: boolean;
  /** جسم الطلب كما يُرسل للخادم (دون المعرّف ووقت التنفيذ). */
  payload: Record<string, unknown>;
  meta: { nationalId: string; name: string; cycleName: string; entitlementId: string; cylinderId?: string; label?: string; seq?: number; amount?: string };
  result?: unknown;
};

export const UNSYNCED: OpStatus[] = ["local", "pending"];
export const isUnsynced = (op: QueuedOp) => UNSYNCED.includes(op.status);

// ---------------------------------------------------------------------------
// المال بالقروش (أعداد صحيحة) لتجنب أخطاء الكسور
// ---------------------------------------------------------------------------

export const toCents = (v: string | number) => {
  const [i, f = ""] = String(v).trim().split(".");
  const sign = i.startsWith("-") ? -1 : 1;
  return sign * (Math.abs(Number(i)) * 100 + Number((f + "00").slice(0, 2)));
};
export const fromCents = (c: number) => `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, "0")}`;

// ---------------------------------------------------------------------------
// البحث من بيانات الجهاز، وتطبيق العمليات غير المتزامنة
// ---------------------------------------------------------------------------

function finish(nationalId: string, citizen: Found["citizen"], ents: Ent[]): Found {
  const total = ents.reduce((a, e) => a + toCents(e.amountRemaining), 0);
  return { found: true, nationalId, citizen, totalRemaining: fromCents(total), entitlements: ents };
}

/** يعيد حساب الحقول المشتقة للاستحقاق بالقواعد نفسها التي يطبقها الخادم في بحث الشباك. */
function derive(e: Omit<Ent, "remaining" | "canReceive" | "amountRemaining" | "canPay">, billable: boolean): Ent {
  const live = e.cylinders.filter((c) => c.status !== "VOID");
  const rem = billable ? toCents(e.amountDue) - toCents(e.paid) : 0;
  return {
    ...e,
    cylinders: live,
    remaining: Math.max(0, e.quantity - live.length),
    canReceive: e.status === "ACTIVE" && e.cycle.status === "OPEN" && live.length < e.quantity,
    amountRemaining: fromCents(Math.max(0, rem)),
    canPay: billable && rem > 0,
  };
}

const billableOf = (e: Ent) => e.status === "ACTIVE" || e.cylinders.some((c) => c.status !== "VOID") || e.canPay;

/** بحث الشباك من لقطة الجهاز: الشكل نفسه الذي يرجعه الخادم. */
export function lookupFromSnapshot(snap: Snapshot, nationalId: string): Lookup {
  const c = snap.citizens.find((x) => x.nationalId === nationalId);
  if (!c) return { found: false, nationalId };
  const ents = c.entitlements.map((e) => derive({ id: e.id, cycle: e.cycle, status: e.status, citizenNumber: e.citizenNumber, quantity: e.quantity, amountDue: e.amountDue, paid: e.paid, cylinders: e.cylinders }, e.billable));
  return finish(nationalId, { id: c.citizenId, fullName: c.fullName, phone: null }, ents);
}

/**
 * يطبق العمليات غير المتزامنة على نتيجة البحث (من الخادم أو الجهاز)، حتى لا يكرر الجهاز
 * استلامًا أو تسليمًا أو تحصيلًا ينتظر المزامنة. التحصيل المعلق يُخصم دائمًا (الاتجاه الآمن).
 */
export function applyOverlay(look: Lookup, ops: QueuedOp[]): Lookup {
  if (!look.found) return look;
  const pending = ops.filter((o) => isUnsynced(o));
  if (!pending.length) return look;
  const ents = look.entitlements.map((e) => {
    const mine = pending.filter((o) => o.meta.entitlementId === e.id);
    if (!mine.length) return e;
    let cylinders = [...e.cylinders];
    let paid = toCents(e.paid);
    for (const op of mine) {
      if (op.kind === "receive" && op.meta.label && !cylinders.some((c) => c.label === op.meta.label)) {
        const seq = op.meta.seq ?? nextSeq(cylinders);
        cylinders.push({ id: `local:${op.id}`, label: op.meta.label, status: "EMPTY", seq, local: true });
      } else if (op.kind === "deliver" && op.meta.cylinderId) {
        cylinders = cylinders.map((c) => (c.id === op.meta.cylinderId ? { ...c, status: "DELIVERED", local: true } : c));
      } else if (op.kind === "payment" && op.meta.amount) {
        paid += toCents(op.meta.amount);
      }
    }
    return derive({ ...e, cylinders, paid: fromCents(paid) }, billableOf(e));
  });
  return finish(look.nationalId, look.citizen, ents);
}

const nextSeq = (cylinders: Cyl[]) => {
  const used = new Set(cylinders.filter((c) => c.status !== "VOID").map((c) => c.seq));
  let seq = 1;
  while (used.has(seq)) seq++;
  return seq;
};

/** رقم الجرة التالية للاستحقاق، كما سيحسبه الخادم (أصغر تسلسل غير مستخدم). */
export function nextCylinder(e: Ent) {
  const seq = nextSeq(e.cylinders);
  return { seq, label: cylinderLabel(e.citizenNumber, e.quantity, seq) };
}

// ---------------------------------------------------------------------------
// تحقق محلي قبل الحفظ دون اتصال (الخادم يعيد كل التحقق عند المزامنة)
// ---------------------------------------------------------------------------

export function checkReceive(e: Ent): string | null {
  if (e.status !== "ACTIVE") return "هذا الاستحقاق أُزيل من الكشف";
  if (e.cycle.status !== "OPEN") return "الدورة مغلقة؛ لا يمكن استلام جرار جديدة فيها";
  if (!e.canReceive) return "استُلمت كل جرار هذا الاستحقاق";
  return null;
}

export function checkDeliver(c: Cyl, typedLabel: string): string | null {
  if (c.local && c.status === "DELIVERED") return "سُلّمت هذه الجرة على هذا الجهاز وتنتظر المزامنة";
  if (c.status === "DELIVERED") return "سُلّمت هذه الجرة سابقًا";
  if (c.status !== "FILLED") return "الجرة غير جاهزة للتسليم (لم تُعبأ بعد)";
  if (normalizeLabel(typedLabel) !== c.label) return `الرقم المكتوب على الجرة لا يطابق رقمها (${c.label})`;
  return null;
}

export function checkPayment(e: Ent, amount: string): string | null {
  if (!e.canPay) return "لا يوجد مبلغ متبقٍ على هذا الاستحقاق";
  const a = amount.trim().replace(/[٫,]/g, ".").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(a) || Number(a) <= 0) return "مبلغ غير صالح";
  if (toCents(a) > toCents(e.amountRemaining)) return `المبلغ يتجاوز المتبقي (${e.amountRemaining})`;
  return null;
}

// ---------------------------------------------------------------------------
// المزامنة
// ---------------------------------------------------------------------------

/**
 * تصنيف فشل الإرسال: «retry» عطل مؤقت (لا اتصال، خطأ خادم، جلسة منتهية، تجاوز المعدل)
 * فتبقى العملية بانتظار المزامنة؛ «reject» رفض الخادم للعملية نفسها فتصبح حالة مراجعة.
 */
export function classifyFailure(code: string, status: number): "retry" | "reject" {
  if (code === "NETWORK" || status === 0 || status >= 500 || status === 401 || status === 403 || status === 429) return "retry";
  return "reject";
}

/** عمر اللقطة بالساعات وفق ساعة الجهاز وقت تنزيلها. */
export const snapshotAgeHours = (fetchedAt: string, now = Date.now()) => (now - new Date(fetchedAt).getTime()) / 3_600_000;

/** يحدّث اللقطة بعد تأكيد الخادم لعملية، حتى تبقى صحيحة إلى أن تُنزّل لقطة جديدة. */
export function applySyncedToSnapshot(snap: Snapshot, op: QueuedOp): Snapshot {
  const r = (op.result ?? {}) as { cylinder?: { id: string; label: string; status: CylStatus }; paid?: string };
  return {
    ...snap,
    citizens: snap.citizens.map((c) => ({
      ...c,
      entitlements: c.entitlements.map((e) => {
        if (e.id !== op.meta.entitlementId) return e;
        if (op.kind === "receive" && r.cylinder && !e.cylinders.some((x) => x.id === r.cylinder!.id)) {
          return { ...e, billable: true, cylinders: [...e.cylinders, { id: r.cylinder.id, label: r.cylinder.label, status: r.cylinder.status, seq: nextSeq(e.cylinders) }] };
        }
        if (op.kind === "deliver") return { ...e, cylinders: e.cylinders.map((x) => (x.id === op.meta.cylinderId ? { ...x, status: "DELIVERED" as const } : x)) };
        if (op.kind === "payment" && r.paid) return { ...e, paid: r.paid };
        return e;
      }),
    })),
  };
}
