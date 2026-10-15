import { z } from "zod";
import { Prisma } from "@prisma/client";
import { withTenant } from "../db";
import { type Actor, assertDistributor } from "../actor";
import { AppError } from "../errors";
import { TIME_ZONE } from "@/lib/format";

// ---------------------------------------------------------------------------
// صفحة «الفلوس»: ما يحتاج الموزّع أن يعرفه بنظرة واحدة.
// كل الأيام بتوقيت غزة (حدود اليوم تُحسب في قاعدة البيانات، لا بتوقيت الخادم).
// دفعات المحطات (الطريقة السابقة) تُحسب مصاريف.
// ---------------------------------------------------------------------------

export const PERIODS = ["today", "week", "month", "all", "custom"] as const;
export type Period = (typeof PERIODS)[number];

const schema = z.object({
  period: z.enum(PERIODS).default("today"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
});

export type MoneyItem = {
  id: string;
  kind: "PAYMENT" | "EXPENSE" | "STATION_PAYMENT";
  at: string;
  amount: string; // موجب للمقبوض، سالب للمصروف
  title: string;
  subtitle: string | null;
  citizenId: string | null;
};
export type MoneyDay = { date: string; in: string; out: string; items: MoneyItem[] };

const localDate = (col: Prisma.Sql) => Prisma.sql`((${col} AT TIME ZONE 'UTC') AT TIME ZONE ${TIME_ZONE})::date`;
const money = (v: Prisma.Decimal.Value | null) => new Prisma.Decimal(v ?? 0);

function todayInGaza() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function addDays(ymd: string, n: number) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function moneyOverview(actor: Actor, input: unknown) {
  assertDistributor(actor);
  const v = schema.parse(input ?? {});
  const today = todayInGaza();
  let from: string | null = null;
  let to: string | null = today;
  if (v.period === "today") from = today;
  else if (v.period === "week") from = addDays(today, -6);
  else if (v.period === "month") from = `${today.slice(0, 7)}-01`;
  else if (v.period === "all") to = null;
  else {
    from = v.from ?? null;
    to = v.to ?? null;
    if (from && to && from > to) throw new AppError("VALIDATION", "تاريخ البداية بعد تاريخ النهاية");
  }
  const inRange = (col: Prisma.Sql) =>
    Prisma.sql`${from ? Prisma.sql`AND ${localDate(col)} >= ${from}::date` : Prisma.empty} ${to ? Prisma.sql`AND ${localDate(col)} <= ${to}::date` : Prisma.empty}`;

  return withTenant(actor.distributorId, async (tx) => {
    // الرصيد الذي يُفترض أن يكون مع الموزّع: كل المقبوض ناقص كل المصاريف (منذ البداية).
    const [allTime] = await tx.$queryRaw<{ inn: Prisma.Decimal | null; out: Prisma.Decimal | null; sp: Prisma.Decimal | null }[]>`
      SELECT (SELECT sum("amount") FROM "payments" WHERE "status" = 'ACTIVE') AS inn,
             (SELECT sum("amount") FROM "expenses" WHERE "status" = 'ACTIVE') AS out,
             (SELECT sum("amount") FROM "station_payments" WHERE "status" = 'ACTIVE') AS sp`;

    // المستحق على الناس: كل استحقاق قابل للتحصيل.
    const [dues] = await tx.$queryRaw<{ due: Prisma.Decimal | null; paid: Prisma.Decimal | null; remaining: Prisma.Decimal | null; owing: bigint }[]>`
      WITH b AS (
        SELECT e."amountDue" AS due, COALESCE((SELECT sum(p."amount") FROM "payments" p WHERE p."entitlementId" = e."id" AND p."status" = 'ACTIVE'), 0) AS paid
        FROM "entitlements" e
        WHERE e."status" = 'ACTIVE'
           OR EXISTS (SELECT 1 FROM "cylinders" z WHERE z."entitlementId" = e."id" AND z."status" <> 'VOID')
           OR EXISTS (SELECT 1 FROM "handovers" h WHERE h."entitlementId" = e."id" AND h."status" = 'ACTIVE')
      )
      SELECT sum(due) AS due, sum(paid) AS paid, sum(GREATEST(due - paid, 0)) AS remaining, count(*) FILTER (WHERE due > paid) AS owing FROM b`;

    // الحركات في الفترة (المقبوض والمصاريف ودفعات المحطات).
    const pays = await tx.$queryRaw<{ id: string; at: Date; amount: Prisma.Decimal; name: string; number: string; citizenId: string; notes: string | null }[]>`
      SELECT p."id", p."paidAt" AS at, p."amount", e."nameInStatement" AS name, e."citizenNumber" AS number, e."citizenId", p."notes"
      FROM "payments" p JOIN "entitlements" e ON e."id" = p."entitlementId"
      WHERE p."status" = 'ACTIVE' ${inRange(Prisma.sql`p."paidAt"`)}
      ORDER BY p."paidAt" DESC LIMIT 1000`;
    const exps = await tx.$queryRaw<{ id: string; at: Date; amount: Prisma.Decimal; description: string }[]>`
      SELECT "id", "spentAt" AS at, "amount", "description" FROM "expenses"
      WHERE "status" = 'ACTIVE' ${inRange(Prisma.sql`"spentAt"`)} ORDER BY "spentAt" DESC LIMIT 1000`;
    const sps = await tx.$queryRaw<{ id: string; at: Date; amount: Prisma.Decimal; station: string; reference: string | null }[]>`
      SELECT sp."id", sp."paidAt" AS at, sp."amount", s."name" AS station, sp."reference"
      FROM "station_payments" sp JOIN "stations" s ON s."id" = sp."stationId"
      WHERE sp."status" = 'ACTIVE' ${inRange(Prisma.sql`sp."paidAt"`)} ORDER BY sp."paidAt" DESC LIMIT 1000`;

    const items: MoneyItem[] = [
      ...pays.map((p) => ({ id: p.id, kind: "PAYMENT" as const, at: p.at.toISOString(), amount: money(p.amount).toFixed(2), title: p.name, subtitle: `رقم ${p.number}${p.notes ? ` · ${p.notes}` : ""}`, citizenId: p.citizenId })),
      ...exps.map((x) => ({ id: x.id, kind: "EXPENSE" as const, at: x.at.toISOString(), amount: money(x.amount).neg().toFixed(2), title: x.description, subtitle: null, citizenId: null })),
      ...sps.map((x) => ({ id: x.id, kind: "STATION_PAYMENT" as const, at: x.at.toISOString(), amount: money(x.amount).neg().toFixed(2), title: `دفعة لمحطة ${x.station}`, subtitle: x.reference, citizenId: null })),
    ].sort((a, b) => b.at.localeCompare(a.at));

    const sumIn = pays.reduce((a, p) => a.add(p.amount), money(0));
    const sumOut = exps.reduce((a, x) => a.add(x.amount), money(0)).add(sps.reduce((a, x) => a.add(x.amount), money(0)));

    // التجميع حسب اليوم (بتوقيت غزة).
    const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
    const days = new Map<string, MoneyDay>();
    for (const it of items.slice(0, 500)) {
      const d = dayOf(it.at);
      const day = days.get(d) ?? { date: d, in: "0.00", out: "0.00", items: [] };
      const amt = money(it.amount);
      if (amt.isPos()) day.in = money(day.in).add(amt).toFixed(2);
      else day.out = money(day.out).add(amt.abs()).toFixed(2);
      day.items.push(it);
      days.set(d, day);
    }

    const inn = money(allTime.inn), out = money(allTime.out).add(money(allTime.sp));
    return {
      period: { key: v.period, from, to, today },
      cashInHand: inn.sub(out).toFixed(2),
      allTime: { collected: inn.toFixed(2), spent: out.toFixed(2) },
      inPeriod: { collected: sumIn.toFixed(2), collectedCount: pays.length, spent: sumOut.toFixed(2), spentCount: exps.length + sps.length, net: sumIn.sub(sumOut).toFixed(2) },
      dues: {
        due: money(dues?.due).toFixed(2), paid: money(dues?.paid).toFixed(2), remaining: money(dues?.remaining).toFixed(2), owing: Number(dues?.owing ?? 0),
      },
      days: [...days.values()],
      truncated: items.length > 500,
    };
  }, { timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// ربح كل كشف: (سعر الجرة على المواطن − سعر الجرة على الموزّع) × الجرار.
// البيع = مجموع المطلوب من الناس في الكشف (يشمل مبالغ الهيئة إن وردت)،
// والتكلفة = سعر الموزّع × عدد الجرار. «الصافي حتى الآن» = المقبوض − التكلفة،
// ويصير هو الربح عندما ينقبض كل شيء.
// ---------------------------------------------------------------------------

export type StatementProfit = {
  id: string;
  title: string;
  importedAt: string;
  salePrice: string | null;
  costPrice: string | null;
  margin: string | null;
  people: number;
  cylinders: number;
  handedCylinders: number;
  sale: string;
  cost: string | null;
  profit: string | null;
  collected: string;
  remaining: string;
  netSoFar: string | null;
  done: boolean;
};

export async function statementProfits(actor: Actor) {
  assertDistributor(actor);
  return withTenant(actor.distributorId, async (tx) => {
    const rows = await tx.$queryRaw<{
      id: string; title: string; importedAt: Date; salePrice: Prisma.Decimal | null; costPrice: Prisma.Decimal | null;
      people: bigint; cylinders: bigint | null; handed: bigint | null; sale: Prisma.Decimal | null; collected: Prisma.Decimal | null; remaining: Prisma.Decimal | null;
    }[]>`
      WITH e AS (
        SELECT e."statementId", e."quantity", e."amountDue",
          COALESCE((SELECT sum(p."amount") FROM "payments" p WHERE p."entitlementId" = e."id" AND p."status" = 'ACTIVE'), 0) AS paid,
          COALESCE((SELECT sum(h."quantity") FROM "handovers" h WHERE h."entitlementId" = e."id" AND h."status" = 'ACTIVE'), 0) AS handed
        FROM "entitlements" e
        WHERE e."status" = 'ACTIVE'
           OR EXISTS (SELECT 1 FROM "payments" p WHERE p."entitlementId" = e."id" AND p."status" = 'ACTIVE')
           OR EXISTS (SELECT 1 FROM "handovers" h WHERE h."entitlementId" = e."id" AND h."status" = 'ACTIVE')
      )
      SELECT s."id", s."title", s."importedAt", COALESCE(s."unitPrice", c."unitPrice") AS "salePrice", s."costPrice",
        count(e."statementId") AS people, sum(e."quantity") AS cylinders, sum(e."handed") AS handed,
        sum(e."amountDue") AS sale, sum(e."paid") AS collected, sum(GREATEST(e."amountDue" - e."paid", 0)) AS remaining
      FROM "statements" s
      LEFT JOIN "cycles" c ON c."id" = s."cycleId"
      LEFT JOIN e ON e."statementId" = s."id"
      WHERE s."status" = 'APPROVED'
      GROUP BY s."id", c."unitPrice"
      ORDER BY s."importedAt" DESC
      LIMIT 100`;

    const items: StatementProfit[] = rows.map((r) => {
      const cylinders = Number(r.cylinders ?? 0);
      const sale = money(r.sale), collected = money(r.collected), remaining = money(r.remaining);
      const cost = r.costPrice ? money(r.costPrice).mul(cylinders) : null;
      const handedCylinders = Number(r.handed ?? 0);
      return {
        id: r.id,
        title: r.title,
        importedAt: r.importedAt.toISOString(),
        salePrice: r.salePrice ? money(r.salePrice).toFixed(2) : null,
        costPrice: r.costPrice ? money(r.costPrice).toFixed(2) : null,
        margin: r.salePrice && r.costPrice ? money(r.salePrice).sub(r.costPrice).toFixed(2) : null,
        people: Number(r.people),
        cylinders,
        handedCylinders,
        sale: sale.toFixed(2),
        cost: cost?.toFixed(2) ?? null,
        profit: cost ? sale.sub(cost).toFixed(2) : null,
        collected: collected.toFixed(2),
        remaining: remaining.toFixed(2),
        netSoFar: cost ? collected.sub(cost).toFixed(2) : null,
        done: cylinders > 0 && remaining.isZero() && handedCylinders >= cylinders,
      };
    });
    const priced = items.filter((i) => i.profit !== null);
    return {
      items,
      totals: {
        profit: priced.reduce((a, i) => a.add(i.profit!), money(0)).toFixed(2),
        realized: priced.filter((i) => i.done).reduce((a, i) => a.add(i.profit!), money(0)).toFixed(2),
        missingCost: items.length - priced.length,
      },
    };
  });
}
