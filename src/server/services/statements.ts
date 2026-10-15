import { z } from "zod";
import { Prisma, type Statement, type StatementRow } from "@prisma/client";
import type { Tx } from "../db";
import { withTenant } from "../db";
import { AppError, notFound } from "../errors";
import { type Actor, type DistributorActor, assertDistributor } from "../actor";
import { audit } from "../audit";
import { cleanText, normalizeName, normalizePhone } from "@/lib/arabic";
import { isValidNationalId, normalizeNationalId } from "@/lib/national-id";
import { itemsToTable, type TextItem } from "@/lib/table-from-items";
import {
  applyMapping, detectMapping, extractStatementMeta, FIELDS, markDuplicates, REQUIRED_FIELDS, rescale, severityOf, suggestCycleFromText, withScale,
  type ColumnMapping, type ParsedRow, type RawTable, type RowIssue,
} from "../statements/mapping";
import { detectKind, extractExcel, extractPdf, looksLikeHeader, type Extraction } from "../statements/extract";
import { sha256Hex, storeFile } from "./files";
import { getActiveCycle, lockCycle } from "./cycles";
import { assertUploadAllowed } from "./settings";
import { cylinderCounts } from "./operations";
import { moneySchema, paidByEntitlement } from "./finance";
import { isolate } from "@/lib/format";

// ---------------------------------------------------------------------------
// أدوات داخلية
// ---------------------------------------------------------------------------

/** مشكلات تنتج عن قراءة الملف نفسه، تبقى ما لم يعدّل الموزّع الصف يدويًا. */
const PARSE_ONLY_CODES = new Set(["AMOUNT_INVALID", "OCR_REVIEW", "NAME_UNREADABLE", "RELATED_ID"]);

function log(tx: Tx, actor: DistributorActor, action: string, statementId: string, after?: unknown, before?: unknown, reason?: string) {
  return audit(tx, actor, { action: `statement.${action}`, entityType: "statement", entityId: statementId, distributorId: actor.distributorId, after, before, reason });
}

async function lockStatement(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "statements" WHERE "id" = ${id}::uuid FOR UPDATE`;
  if (!rows.length) throw notFound("الكشف");
  return tx.statement.findUniqueOrThrow({ where: { id }, include: { cycle: true } });
}

function assertPending(st: Statement) {
  if (st.status !== "PENDING_REVIEW") throw new AppError("INVALID_STATE", "لا يمكن تعديل كشف ليس بانتظار الاعتماد");
}

const effectiveAmount = (row: { amount: Prisma.Decimal | null; quantity: number | null }, unitPrice: Prisma.Decimal) =>
  row.amount ?? unitPrice.mul(row.quantity ?? 0);

/** سعر الجرة المعتمد للكشف: سعر الكشف نفسه، وإلا سعر الدورة (للكشوف القديمة قبل إضافة السعر لكل كشف). */
const priceOf = (st: { unitPrice: Prisma.Decimal | null; cycle: { unitPrice: Prisma.Decimal } | null }) => st.unitPrice ?? st.cycle?.unitPrice ?? null;

const priceSchema = moneySchema.transform((v) => new Prisma.Decimal(v));

async function replaceRows(tx: Tx, actor: DistributorActor, statementId: string, rows: ParsedRow[], scaleNumber: string | null) {
  await tx.statementRow.deleteMany({ where: { statementId } });
  if (!rows.length) return;
  await tx.statementRow.createMany({
    data: rows.map((r) => ({
      distributorId: actor.distributorId,
      statementId,
      rowIndex: r.rowIndex,
      nationalId: r.nationalId,
      fullName: r.fullName,
      phone: r.phone,
      citizenNumber: withScale(scaleNumber, r.citizenNumber),
      quantity: r.quantity,
      amount: r.amount === null ? null : new Prisma.Decimal(r.amount),
      issues: r.issues as unknown as Prisma.InputJsonValue,
      severity: severityOf(r.issues),
    })),
  });
}

/** التحقق من الصف من قيمه المخزنة (بعد أي تعديل يدوي). */
function intrinsicIssues(r: StatementRow): RowIssue[] {
  const issues: RowIssue[] = [];
  if (!r.nationalId) issues.push({ field: "nationalId", code: "ID_MISSING", message: "رقم الهوية مفقود", severity: "ERROR" });
  else if (!isValidNationalId(r.nationalId)) issues.push({ field: "nationalId", code: "ID_INVALID", message: "رقم الهوية غير صالح (فشل رقم التحقق)", severity: "ERROR" });
  if (!r.fullName) issues.push({ field: "fullName", code: "NAME_MISSING", message: "الاسم مفقود", severity: "ERROR" });
  if (!r.citizenNumber) issues.push({ field: "citizenNumber", code: "NUMBER_MISSING", message: "رقم المواطن في الكشف مفقود", severity: "ERROR" });
  if (!r.quantity || r.quantity < 1 || r.quantity > 20) issues.push({ field: "quantity", code: "QTY_INVALID", message: "عدد الجرار غير صالح", severity: "ERROR" });
  if (r.phone && !/^\+?\d{7,15}$/.test(r.phone)) issues.push({ field: "phone", code: "PHONE_INVALID", message: "رقم الهاتف غير صالح", severity: "WARNING" });
  return issues;
}

/**
 * يعيد التحقق من كل صفوف الكشف: القيم، التكرار داخل الكشف، ثم التحقق مقابل قاعدة البيانات
 * (اسم مختلف لرقم هوية مسجل، استحقاق قائم في كشف آخر بالدورة نفسها، رقم مواطن مستخدم، اختلاف المبلغ).
 */
async function revalidate(tx: Tx, st: Statement & { cycle: { unitPrice: Prisma.Decimal; id: string } | null }) {
  const rows = await tx.statementRow.findMany({ where: { statementId: st.id }, orderBy: { rowIndex: "asc" } });
  const work = rows.map((r) => {
    const kept = r.editedAt ? [] : ((r.issues as unknown as RowIssue[]) ?? []).filter((i) => PARSE_ONLY_CODES.has(i.code));
    return { row: r, nationalId: r.nationalId, citizenNumber: r.citizenNumber, issues: [...intrinsicIssues(r), ...kept] };
  });
  const included = work.filter((w) => !w.row.excluded);
  markDuplicates(included);

  const ids = [...new Set(included.map((w) => w.nationalId).filter((x): x is string => !!x))];
  const numbers = [...new Set(included.map((w) => w.citizenNumber).filter((x): x is string => !!x))];
  const citizens = ids.length ? await tx.citizen.findMany({ where: { nationalId: { in: ids } } }) : [];
  const citizenByNid = new Map(citizens.map((c) => [c.nationalId, c]));
  // المواطن المدموج يُعامل كالمواطن الأساسي.
  const primaryOf = (cid: string) => citizens.find((c) => c.id === cid)?.mergedIntoId ?? cid;

  let others: { citizenId: string; citizenNumber: string; citizen: { nationalId: string } }[] = [];
  if (st.cycleId && (ids.length || numbers.length)) {
    others = await tx.entitlement.findMany({
      where: {
        cycleId: st.cycleId,
        status: "ACTIVE",
        ...(st.supersedesId ? { statementId: { not: st.supersedesId } } : {}),
        OR: [{ citizen: { nationalId: { in: ids } } }, { citizenNumber: { in: numbers } }, { citizenId: { in: citizens.map((c) => c.mergedIntoId).filter((x): x is string => !!x) } }],
      },
      select: { citizenId: true, citizenNumber: true, citizen: { select: { nationalId: true } } },
    });
  }

  // أثر الإصدار الجديد على الجرار المستلمة فعلًا: رقم المواطن مكتوب على الجرة فلا يتغير،
  // والعدد لا يقل عن المستلم.
  const prevByNid = new Map<string, { citizenNumber: string; received: number; paid: Prisma.Decimal }>();
  if (st.supersedesId) {
    const prev = await tx.entitlement.findMany({ where: { statementId: st.supersedesId, status: "ACTIVE" }, select: { id: true, citizenNumber: true, citizen: { select: { nationalId: true } } } });
    const counts = await cylinderCounts(tx, prev.map((e) => e.id));
    const paid = await paidByEntitlement(tx, prev.map((e) => e.id));
    for (const e of prev) prevByNid.set(e.citizen.nationalId, { citizenNumber: e.citizenNumber, received: counts.get(e.id) ?? 0, paid: paid.get(e.id) ?? new Prisma.Decimal(0) });
  }

  for (const w of included) {
    const r = w.row;
    const p = r.nationalId ? prevByNid.get(r.nationalId) : undefined;
    if (p && p.received > 0) {
      if (r.citizenNumber && r.citizenNumber !== p.citizenNumber) {
        w.issues.push({ field: "citizenNumber", code: "NUMBER_LOCKED", message: `لا يمكن تغيير رقم المواطن (${isolate(p.citizenNumber)}): استُلمت له ${p.received} جرة مكتوب عليها الرقم`, severity: "ERROR" });
      }
      if (r.quantity && r.quantity < p.received) {
        w.issues.push({ field: "quantity", code: "QTY_BELOW_RECEIVED", message: `عدد الجرار أقل من المستلم فعلًا (${p.received})`, severity: "ERROR" });
      }
    }
    const price = priceOf(st);
    if (p && p.paid.gt(0) && r.quantity && price && effectiveAmount(r, price).lt(p.paid)) {
      w.issues.push({ field: "amount", code: "AMOUNT_BELOW_PAID", message: `المبلغ الجديد أقل من المدفوع فعلًا (${p.paid.toFixed(2)})`, severity: "ERROR" });
    }
    const c = r.nationalId ? citizenByNid.get(r.nationalId) : undefined;
    if (c && r.fullName && normalizeName(c.fullName) !== normalizeName(r.fullName)) {
      w.issues.push({ field: "fullName", code: "NAME_MISMATCH", message: `الاسم يختلف عن المسجل لهذا الرقم: ${c.fullName}`, severity: "WARNING" });
    }
    if (c && others.some((o) => primaryOf(o.citizenId) === primaryOf(c.id))) {
      w.issues.push({ field: "nationalId", code: "DUPLICATE_IN_CYCLE", message: "للمواطن استحقاق نشط في كشف آخر معتمد بهذه الدورة", severity: "ERROR" });
    }
    if (r.citizenNumber && others.some((o) => o.citizenNumber === r.citizenNumber && o.citizen.nationalId !== r.nationalId)) {
      w.issues.push({ field: "citizenNumber", code: "NUMBER_TAKEN", message: "رقم المواطن مستخدم لمواطن آخر في هذه الدورة", severity: "ERROR" });
    }
    if (price && r.amount && r.quantity && !r.amount.equals(price.mul(r.quantity))) {
      w.issues.push({
        field: "amount",
        code: "AMOUNT_MISMATCH",
        message: `المبلغ في الكشف (${r.amount}) يختلف عن عدد الجرار × سعر الجرة (${price.mul(r.quantity)}). سيُعتمد مبلغ الكشف`,
        severity: "WARNING",
      });
    }
  }

  const payload = work.map((w) => ({ id: w.row.id, issues: w.issues, sev: severityOf(w.issues) }));
  if (payload.length) {
    await tx.$executeRaw`
      UPDATE "statement_rows" AS r SET "issues" = v.issues, "severity" = v.sev::"RowSeverity"
      FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS v(id uuid, issues jsonb, sev text)
      WHERE r."id" = v.id`;
  }
  const errors = payload.filter((p, i) => !work[i].row.excluded && p.sev === "ERROR").length;
  return { errors, included: included.length };
}

async function duplicateFiles(tx: Tx, sha: string, exceptStatementId?: string) {
  return tx.statement.findMany({
    where: { file: { sha256: sha }, status: { not: "DISCARDED" }, ...(exceptStatementId ? { id: { not: exceptStatementId } } : {}) },
    select: { id: true, title: true, status: true, importedAt: true },
  });
}

// ---------------------------------------------------------------------------
// الاستيراد
// ---------------------------------------------------------------------------

const uploadMetaSchema = z.object({
  title: z.string().trim().max(150).optional(),
  unitPrice: priceSchema.optional().or(z.literal("").transform(() => undefined)),
  costPrice: priceSchema.optional().or(z.literal("").transform(() => undefined)),
  supersedesId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
});

/**
 * رفع كشف: يحفظ الملف الأصلي، يستخرج البيانات، ينشئ الكشف بحالة «قيد المراجعة».
 * لا يُنشئ أي مواطن أو استحقاق؛ ذلك يتم عند الاعتماد الصريح فقط.
 */
export async function uploadStatement(actor: Actor, file: { name: string; mime: string; data: Buffer }, meta: unknown) {
  assertDistributor(actor);
  const m = uploadMetaSchema.parse(meta ?? {});
  if (!file.data.length) throw new AppError("VALIDATION", "الملف فارغ");
  await assertUploadAllowed(file.name, file.data.length, ["pdf", "xlsx"]);
  const kind = detectKind(file.name, file.mime, file.data.subarray(0, 8));
  // الاستخراج خارج المعاملة لأنه قد يستغرق وقتًا.
  const ex: Extraction = kind === "excel" ? await extractExcel(file.data) : await extractPdf(file.data);
  const sha = sha256Hex(file.data);

  return withTenant(actor.distributorId, async (tx) => {
    const dups = await duplicateFiles(tx, sha);
    let supersedes: Statement | null = null;
    if (m.supersedesId) {
      supersedes = await tx.statement.findUnique({ where: { id: m.supersedesId } });
      if (!supersedes || supersedes.status !== "APPROVED") throw new AppError("VALIDATION", "الكشف المراد تحديثه غير موجود أو غير معتمد");
    }
    const active = await getActiveCycle(tx);
    const stored = await storeFile(tx, actor, { kind: "STATEMENT", name: file.name, mime: file.mime, data: file.data, sha256: sha });
    const { headerRow, mapping } = ex.table.length ? detectMapping(ex.table) : { headerRow: null, mapping: {} };
    const notes = [...ex.notes];
    const missing = REQUIRED_FIELDS.filter((f) => mapping[f] === undefined || mapping[f] === null);
    if (ex.table.length && missing.length) notes.push("تعذر تحديد بعض الأعمدة تلقائيًا؛ حددها يدويًا في شاشة المراجعة");

    const meta = extractStatementMeta(ex.text.slice(0, 2000));
    // كشف بنفس رقم ميزان كشف معتمد في الدورة النشطة هو تحديث له تلقائيًا (يمكن التراجع عن ذلك في المراجعة).
    if (!supersedes && meta.scaleNumber && active) {
      supersedes = await tx.statement.findFirst({ where: { status: "APPROVED", cycleId: active.id, scaleNumber: meta.scaleNumber }, orderBy: { approvedAt: "desc" } });
      if (supersedes) notes.push(`اعتُبر تحديثًا لكشف «${supersedes.title}» لأنه بنفس رقم الميزان (${meta.scaleNumber}). راجع الفروق قبل الاعتماد، أو اختر «كشف مستقل» من الإعدادات.`);
    }
    // تحديث كشف سابق يُبقي رقم ميزانه، فلا تتغير أرقام المواطنين المكتوبة على الجرار.
    const scaleNumber = supersedes ? supersedes.scaleNumber : meta.scaleNumber;
    const autoTitle = meta.date || meta.scaleNumber
      ? `كشف${meta.date ? ` ${meta.date}` : ""}${meta.scaleNumber ? ` — ميزان ${meta.scaleNumber}` : ""}`
      : file.name.replace(/\.[^.]+$/, "");
    const st = await tx.statement.create({
      data: {
        distributorId: actor.distributorId,
        title: m.title || autoTitle,
        scaleNumber,
        // سعر الجرة: المُدخل عند الرفع، وإلا سعر الكشف السابق (عند التحديث)، وإلا سعر الدورة النشطة.
        unitPrice: m.unitPrice ?? supersedes?.unitPrice ?? active?.unitPrice ?? null,
        // سعر الجرة على الموزّع: المُدخل، وإلا سعر الكشف السابق عند التحديث.
        costPrice: m.costPrice ?? supersedes?.costPrice ?? null,
        cycleId: supersedes?.cycleId ?? active?.id ?? null,
        supersedesId: supersedes?.id ?? null,
        version: supersedes ? supersedes.version + 1 : 1,
        fileId: stored.id,
        parseMethod: ex.needsOcr ? null : ex.method,
        rawTable: ex.table as unknown as Prisma.InputJsonValue,
        headerRow,
        columnMapping: mapping as Prisma.InputJsonValue,
        extraction: { needsOcr: ex.needsOcr, notes, duplicateOf: dups, meta } as unknown as Prisma.InputJsonValue,
        suggestedCycle: suggestCycleFromText(ex.text),
        importedById: actor.userId,
      },
      include: { cycle: true },
    });
    if (ex.table.length) {
      await replaceRows(tx, actor, st.id, applyMapping(ex.table, headerRow, mapping), st.scaleNumber);
      await revalidate(tx, st);
    }
    await log(tx, actor, "import", st.id, { title: st.title, file: file.name, size: file.data.length, method: ex.method, needsOcr: ex.needsOcr, duplicateOf: dups.map((d) => d.id) });
    return { id: st.id, duplicateOf: dups, needsOcr: ex.needsOcr };
  }, { timeout: 60_000 });
}

const ocrItemSchema = z.object({
  text: z.string().max(200),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  page: z.number().int().min(1),
});
const ocrSchema = z.object({ items: z.array(ocrItemSchema).max(200_000), confidence: z.number().min(0).max(100).optional() });

/**
 * نتيجة القراءة الضوئية (تُنفذ في متصفح الموزّع). كل الصفوف تُعلَّم «تحتاج مراجعة»،
 * لأن القراءة الضوئية غير موثوقة بطبيعتها.
 */
export async function submitOcr(actor: Actor, statementId: string, input: unknown) {
  assertDistributor(actor);
  const v = ocrSchema.parse(input);
  return withTenant(actor.distributorId, async (tx) => {
    const st = await lockStatement(tx, statementId);
    assertPending(st);
    // حدود الجداول تُقرأ ضوئيًا كرموز مثل | و — ؛ نحذف الكلمات الخالية من الحروف والأرقام.
    const words = (v.items as TextItem[]).filter((i) => /[\p{L}\p{N}]/u.test(i.text));
    const table = itemsToTable(words, looksLikeHeader);
    const { headerRow, mapping } = detectMapping(table);
    const rows = applyMapping(table, headerRow, mapping);
    for (const r of rows) r.issues.push({ code: "OCR_REVIEW", message: "مقروء ضوئيًا: تحقق من القيم مقابل الملف الأصلي", severity: "WARNING" });
    const extraction = { ...((st.extraction as object) ?? {}), needsOcr: false, ocrConfidence: v.confidence ?? null };
    const scaleNumber = st.scaleNumber ?? (st.supersedesId ? null : extractStatementMeta(v.items.slice(0, 400).map((i) => i.text).join(" ")).scaleNumber);
    const updated = await tx.statement.update({
      where: { id: st.id },
      data: {
        parseMethod: "PDF_OCR",
        scaleNumber,
        rawTable: table as unknown as Prisma.InputJsonValue,
        headerRow,
        columnMapping: mapping as Prisma.InputJsonValue,
        extraction: extraction as Prisma.InputJsonValue,
        suggestedCycle: st.suggestedCycle ?? suggestCycleFromText(v.items.map((i) => i.text).join(" ")),
      },
      include: { cycle: true },
    });
    await replaceRows(tx, actor, st.id, rows, updated.scaleNumber);
    await revalidate(tx, updated);
    await log(tx, actor, "ocr", st.id, { rows: rows.length, confidence: v.confidence });
    return { rows: rows.length };
  }, { timeout: 60_000 });
}

// ---------------------------------------------------------------------------
// المراجعة
// ---------------------------------------------------------------------------

const mappingSchema = z.object({
  headerRow: z.number().int().min(0).nullable(),
  mapping: z.object(Object.fromEntries(FIELDS.map((f) => [f, z.number().int().min(0).nullable().optional()])) as Record<(typeof FIELDS)[number], z.ZodOptional<z.ZodNullable<z.ZodNumber>>>),
});

/** تغيير ربط الأعمدة يعيد استخراج الصفوف من الجدول الخام (تُفقد التعديلات اليدوية على الصفوف). */
export async function updateMapping(actor: Actor, statementId: string, input: unknown) {
  assertDistributor(actor);
  const v = mappingSchema.parse(input);
  return withTenant(actor.distributorId, async (tx) => {
    const st = await lockStatement(tx, statementId);
    assertPending(st);
    const table = (st.rawTable as RawTable | null) ?? [];
    if (!table.length) throw new AppError("INVALID_STATE", "لا توجد بيانات مستخرجة لهذا الكشف");
    const mapping = v.mapping as ColumnMapping;
    const used = Object.values(mapping).filter((c) => c !== null && c !== undefined);
    if (new Set(used).size !== used.length) throw new AppError("VALIDATION", "لا يمكن ربط عمود واحد بأكثر من حقل");
    const updated = await tx.statement.update({ where: { id: st.id }, data: { headerRow: v.headerRow, columnMapping: mapping as Prisma.InputJsonValue }, include: { cycle: true } });
    await replaceRows(tx, actor, st.id, applyMapping(table, v.headerRow, mapping), st.scaleNumber);
    await revalidate(tx, updated);
    await log(tx, actor, "remap", st.id, v, { headerRow: st.headerRow, mapping: st.columnMapping });
  }, { timeout: 60_000 });
}

const rowEditSchema = z.object({
  nationalId: z.string().trim().max(20).nullable().optional(),
  fullName: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  citizenNumber: z.string().trim().max(30).nullable().optional(),
  quantity: z.coerce.number().int().min(0).max(100).nullable().optional(),
  amount: z.union([z.string(), z.number()]).nullable().optional(),
  excluded: z.boolean().optional(),
});

/** تصحيح صف أثناء المراجعة (أو استبعاده). يُسجل القديم والجديد في التدقيق. */
export async function updateRow(actor: Actor, statementId: string, rowId: string, input: unknown) {
  assertDistributor(actor);
  const v = rowEditSchema.parse(input);
  return withTenant(actor.distributorId, async (tx) => {
    const st = await lockStatement(tx, statementId);
    assertPending(st);
    const row = await tx.statementRow.findFirst({ where: { id: rowId, statementId } });
    if (!row) throw notFound("الصف");
    const data: Prisma.StatementRowUpdateInput = { editedById: actor.userId, editedAt: new Date() };
    if (v.nationalId !== undefined) data.nationalId = normalizeNationalId(v.nationalId);
    if (v.fullName !== undefined) data.fullName = cleanText(v.fullName) || null;
    if (v.phone !== undefined) data.phone = normalizePhone(v.phone);
    if (v.citizenNumber !== undefined) data.citizenNumber = withScale(st.scaleNumber, cleanText(v.citizenNumber) || null);
    if (v.quantity !== undefined) data.quantity = v.quantity;
    if (v.amount !== undefined) {
      const a = v.amount === null || v.amount === "" ? null : String(v.amount).replace(/[٫,]/g, ".");
      if (a !== null && !/^\d{1,8}(\.\d{1,2})?$/.test(a)) throw new AppError("VALIDATION", "مبلغ غير صالح", { amount: "مبلغ غير صالح" });
      data.amount = a === null ? null : new Prisma.Decimal(a);
    }
    if (v.excluded !== undefined) data.excluded = v.excluded;
    const after = await tx.statementRow.update({ where: { id: rowId }, data });
    await revalidate(tx, st);
    const pick = (r: StatementRow) => ({ nationalId: r.nationalId, fullName: r.fullName, phone: r.phone, citizenNumber: r.citizenNumber, quantity: r.quantity, amount: r.amount, excluded: r.excluded });
    await log(tx, actor, "row_edit", st.id, { rowIndex: row.rowIndex, ...pick(after) }, { rowIndex: row.rowIndex, ...pick(row) });
    return tx.statementRow.findUniqueOrThrow({ where: { id: rowId } });
  }, { timeout: 60_000 });
}

const metaSchema = z.object({
  title: z.string().trim().min(1).max(150).optional(),
  cycleId: z.string().uuid().nullable().optional(),
  supersedesId: z.string().uuid().nullable().optional(),
  unitPrice: priceSchema.optional(),
  scaleNumber: z.string().trim().regex(/^\d{1,6}$/, "رقم الميزان أرقام فقط").nullable().optional().or(z.literal("").transform(() => null)),
});

/** تحديد الدورة (أو الإصدار السابق) للكشف قبل اعتماده. */
export async function updateStatementMeta(actor: Actor, statementId: string, input: unknown) {
  assertDistributor(actor);
  const v = metaSchema.parse(input);
  return withTenant(actor.distributorId, async (tx) => {
    const st = await lockStatement(tx, statementId);
    assertPending(st);
    const data: Prisma.StatementUncheckedUpdateInput = {};
    if (v.title) data.title = v.title;
    if (v.unitPrice) data.unitPrice = v.unitPrice;
    if (v.supersedesId !== undefined) {
      if (v.supersedesId) {
        const prev = await tx.statement.findUnique({ where: { id: v.supersedesId } });
        if (!prev || prev.status !== "APPROVED") throw new AppError("VALIDATION", "الكشف السابق غير موجود أو غير معتمد");
        data.supersedesId = prev.id;
        data.scaleNumber = prev.scaleNumber; // أرقام المواطنين تبقى كما في الإصدار السابق
        data.version = prev.version + 1;
        data.cycleId = prev.cycleId; // الإصدار الجديد يتبع دورة الإصدار السابق
      } else {
        data.supersedesId = null;
        data.version = 1;
      }
    }
    if (v.cycleId !== undefined && !data.supersedesId && !(st.supersedesId && v.supersedesId === undefined)) {
      if (v.cycleId && !(await tx.cycle.findUnique({ where: { id: v.cycleId } }))) throw notFound("الدورة");
      data.cycleId = v.cycleId;
    }
    if (v.scaleNumber !== undefined && data.scaleNumber === undefined) {
      if (st.supersedesId && v.supersedesId !== null && v.scaleNumber !== st.scaleNumber) throw new AppError("VALIDATION", "رقم الميزان يتبع الإصدار السابق ولا يتغير عند تحديث كشف");
      data.scaleNumber = v.scaleNumber;
    }
    const updated = await tx.statement.update({ where: { id: st.id }, data, include: { cycle: true } });
    if (updated.scaleNumber !== st.scaleNumber) {
      // إعادة بناء أرقام المواطنين في الصفوف برقم الميزان الجديد.
      const rows = await tx.statementRow.findMany({ where: { statementId: st.id }, select: { id: true, citizenNumber: true } });
      const payload = rows
        .map((r) => ({ id: r.id, n: rescale(st.scaleNumber, updated.scaleNumber, r.citizenNumber) }))
        .filter((r, i) => r.n !== rows[i].citizenNumber);
      if (payload.length) {
        await tx.$executeRaw`
          UPDATE "statement_rows" AS r SET "citizenNumber" = v.n
          FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS v(id uuid, n text)
          WHERE r."id" = v.id`;
      }
    }
    await revalidate(tx, updated);
    await log(tx, actor, "meta", st.id, { title: updated.title, cycleId: updated.cycleId, supersedesId: updated.supersedesId, scaleNumber: updated.scaleNumber, unitPrice: updated.unitPrice?.toFixed(2) ?? null }, { title: st.title, cycleId: st.cycleId, supersedesId: st.supersedesId, scaleNumber: st.scaleNumber, unitPrice: st.unitPrice?.toFixed(2) ?? null });
    return updated;
  }, { timeout: 60_000 });
}

export async function discardStatement(actor: Actor, statementId: string, input: unknown) {
  assertDistributor(actor);
  const { reason } = z.object({ reason: z.string().trim().min(3, "يرجى كتابة السبب").max(500) }).parse(input);
  return withTenant(actor.distributorId, async (tx) => {
    const st = await lockStatement(tx, statementId);
    assertPending(st);
    await tx.statement.update({ where: { id: st.id }, data: { status: "DISCARDED", discardedAt: new Date(), discardedById: actor.userId, discardReason: reason } });
    await log(tx, actor, "discard", st.id, { status: "DISCARDED" }, { status: st.status }, reason);
  });
}

// ---------------------------------------------------------------------------
// المقارنة مع الإصدار السابق
// ---------------------------------------------------------------------------

type Change = { field: string; before: string | null; after: string | null };
export type StatementDiff = {
  added: { nationalId: string; fullName: string; citizenNumber: string; quantity: number; amount: string }[];
  changed: { nationalId: string; fullName: string; changes: Change[] }[];
  // received: جرار مستلمة لهذا الاستحقاق؛ تبقى قابلة للتعبئة والتسليم لصاحبها بعد الإزالة.
  removed: { nationalId: string; fullName: string; citizenNumber: string; received: number; paid: string }[];
  unchanged: number;
};

async function computeDiff(tx: Tx, st: Statement & { cycle: { unitPrice: Prisma.Decimal } | null }): Promise<StatementDiff | null> {
  const price = priceOf(st);
  if (!st.supersedesId || !st.cycle || !price) return null;
  const prev = await tx.entitlement.findMany({ where: { statementId: st.supersedesId, status: "ACTIVE" }, include: { citizen: true } });
  const rows = await tx.statementRow.findMany({ where: { statementId: st.id, excluded: false }, orderBy: { rowIndex: "asc" } });
  const prevByNid = new Map(prev.map((e) => [e.citizen.nationalId, e]));
  const seen = new Set<string>();
  const diff: StatementDiff = { added: [], changed: [], removed: [], unchanged: 0 };
  for (const r of rows) {
    if (!r.nationalId) continue;
    seen.add(r.nationalId);
    const amount = effectiveAmount(r, price);
    const e = prevByNid.get(r.nationalId);
    if (!e) {
      diff.added.push({ nationalId: r.nationalId, fullName: r.fullName ?? "", citizenNumber: r.citizenNumber ?? "", quantity: r.quantity ?? 0, amount: amount.toString() });
      continue;
    }
    const changes: Change[] = [];
    const cmp = (field: string, before: string | null, after: string | null) => {
      if ((before ?? "") !== (after ?? "")) changes.push({ field, before, after });
    };
    cmp("citizenNumber", e.citizenNumber, r.citizenNumber);
    cmp("quantity", String(e.quantity), r.quantity === null ? null : String(r.quantity));
    cmp("amountDue", e.amountDue.toFixed(2), amount.toFixed(2));
    cmp("nameInStatement", e.nameInStatement, r.fullName);
    cmp("phoneInStatement", e.phoneInStatement, r.phone);
    if (changes.length) diff.changed.push({ nationalId: r.nationalId, fullName: r.fullName ?? e.nameInStatement, changes });
    else diff.unchanged++;
  }
  const gone = prev.filter((e) => !seen.has(e.citizen.nationalId));
  const counts = await cylinderCounts(tx, gone.map((e) => e.id));
  const paidGone = await paidByEntitlement(tx, gone.map((e) => e.id));
  for (const e of gone) {
    diff.removed.push({ nationalId: e.citizen.nationalId, fullName: e.nameInStatement, citizenNumber: e.citizenNumber, received: counts.get(e.id) ?? 0, paid: (paidGone.get(e.id) ?? new Prisma.Decimal(0)).toFixed(2) });
  }
  return diff;
}

// ---------------------------------------------------------------------------
// العرض
// ---------------------------------------------------------------------------

export async function listStatements(actor: Actor, filters: unknown) {
  assertDistributor(actor);
  const f = z.object({ status: z.enum(["PENDING_REVIEW", "APPROVED", "SUPERSEDED", "DISCARDED"]).optional(), cycleId: z.string().uuid().optional() }).parse(filters ?? {});
  return withTenant(actor.distributorId, async (tx) => {
    const list = await tx.statement.findMany({
      where: { status: f.status, cycleId: f.cycleId },
      orderBy: { importedAt: "desc" },
      include: { cycle: { select: { id: true, name: true, status: true, unitPrice: true } }, file: { select: { originalName: true, size: true } } },
      take: 200,
    });
    const counts = await tx.statementRow.groupBy({ by: ["statementId", "severity"], where: { statementId: { in: list.map((s) => s.id) }, excluded: false }, _count: { _all: true } });
    return list.map(({ rawTable: _raw, ...s }) => {
      void _raw;
      const mine = counts.filter((c) => c.statementId === s.id);
      const n = (sev: string) => mine.find((c) => c.severity === sev)?._count._all ?? 0;
      return { ...s, rowsOk: n("OK"), rowsWarning: n("WARNING"), rowsError: n("ERROR") };
    });
  });
}

const detailFilters = z.object({
  severity: z.enum(["OK", "WARNING", "ERROR", "EXCLUDED"]).optional(),
  q: z.string().trim().max(50).optional(),
  page: z.coerce.number().int().min(1).default(1),
});
const ROWS_PAGE = 100;

export async function getStatement(actor: Actor, statementId: string, filters: unknown = {}) {
  assertDistributor(actor);
  const f = detailFilters.parse(filters ?? {});
  return withTenant(actor.distributorId, async (tx) => {
    const st = await tx.statement.findUnique({
      where: { id: statementId },
      include: { cycle: true, file: { select: { id: true, originalName: true, size: true, mimeType: true, sha256: true } }, supersedes: { select: { id: true, title: true, version: true } } },
    });
    if (!st) throw notFound("الكشف");
    const where: Prisma.StatementRowWhereInput = { statementId };
    if (f.severity === "EXCLUDED") where.excluded = true;
    else if (f.severity) Object.assign(where, { severity: f.severity, excluded: false });
    if (f.q) where.OR = [{ nationalId: { contains: f.q } }, { fullName: { contains: f.q, mode: "insensitive" } }, { citizenNumber: { contains: f.q } }];
    const [rows, total, counts] = await Promise.all([
      tx.statementRow.findMany({ where, orderBy: { rowIndex: "asc" }, skip: (f.page - 1) * ROWS_PAGE, take: ROWS_PAGE }),
      tx.statementRow.count({ where }),
      tx.statementRow.groupBy({ by: ["severity", "excluded"], where: { statementId }, _count: { _all: true } }),
    ]);
    const c = (sev: string) => counts.filter((x) => x.severity === sev && !x.excluded).reduce((a, x) => a + x._count._all, 0);
    const summary = { ok: c("OK"), warning: c("WARNING"), error: c("ERROR"), excluded: counts.filter((x) => x.excluded).reduce((a, x) => a + x._count._all, 0) };
    const diff = st.status === "PENDING_REVIEW" ? await computeDiff(tx, st) : null;
    const table = (st.rawTable as RawTable | null) ?? [];
    const preview = table.slice(0, Math.min(table.length, (st.headerRow ?? 0) + 6));
    const { rawTable: _raw, ...rest } = st;
    void _raw;
    const cycles = await tx.cycle.findMany({ orderBy: { number: "desc" }, select: { id: true, name: true, status: true, unitPrice: true } });
    const approvedStatements = await tx.statement.findMany({ where: { status: "APPROVED", id: { not: st.id } }, select: { id: true, title: true, version: true, cycleId: true }, orderBy: { approvedAt: "desc" } });
    return { statement: rest, rows, total, page: f.page, pageSize: ROWS_PAGE, summary, diff, preview, columns: Math.max(0, ...table.map((r) => r.length)), cycles, approvedStatements };
  });
}

// ---------------------------------------------------------------------------
// الاعتماد
// ---------------------------------------------------------------------------

/**
 * اعتماد الكشف صراحة. في معاملة واحدة وبقفل الكشف والدورة:
 * - يُعاد التحقق، ويُرفض الاعتماد إن بقي صف خاطئ غير مستبعد.
 * - يُنشأ المواطن عند أول ظهور (من الكشف المعتمد فقط)، ويُنشأ/يُحدّث الاستحقاق.
 * - عند التحديث: يُحفظ الإصدار السابق، وتُسجل التغييرات، ويُعلَّم المختفون «أُزيل» دون حذف.
 */
export async function approveStatement(actor: Actor, statementId: string, input: unknown) {
  assertDistributor(actor);
  z.object({ confirm: z.literal(true, { errorMap: () => ({ message: "يجب تأكيد مراجعة البيانات قبل الاعتماد" }) }) }).parse(input);
  return withTenant(actor.distributorId, async (tx) => {
    const st = await lockStatement(tx, statementId);
    assertPending(st);
    if (!st.cycleId || !st.cycle) throw new AppError("VALIDATION", "حدد الدورة قبل الاعتماد");
    const cycle = await lockCycle(tx, st.cycleId);
    if (cycle.status !== "OPEN") throw new AppError("INVALID_STATE", "لا يمكن اعتماد كشف في دورة مغلقة");
    const price = st.unitPrice ?? cycle.unitPrice;
    let prev: Statement | null = null;
    if (st.supersedesId) {
      prev = await lockStatement(tx, st.supersedesId);
      if (prev.status !== "APPROVED") throw new AppError("INVALID_STATE", "الإصدار السابق لم يعد معتمدًا");
      if (prev.cycleId !== st.cycleId) throw new AppError("VALIDATION", "الإصدار الجديد يجب أن يكون في دورة الإصدار السابق");
    }
    const { errors, included } = await revalidate(tx, { ...st, cycle });
    if (errors) throw new AppError("VALIDATION", `لا يمكن الاعتماد: ${errors} صف به أخطاء. صححها أو استبعدها`);
    if (!included) throw new AppError("VALIDATION", "لا توجد صفوف للاعتماد");

    const diff = prev ? await computeDiff(tx, { ...st, cycle }) : null;
    const rows = await tx.statementRow.findMany({ where: { statementId: st.id, excluded: false }, orderBy: { rowIndex: "asc" } });
    const now = new Date();
    const stats = { created: 0, updated: 0, unchanged: 0, removed: 0, newCitizens: 0, restoredCitizens: 0 };

    // 1) المواطنون: إنشاء من الكشف المعتمد فقط، أو اتباع الدمج، أو استعادة من الأرشيف.
    const nids = rows.map((r) => r.nationalId!);
    const existing = await tx.citizen.findMany({ where: { nationalId: { in: nids } } });
    const byNid = new Map(existing.map((c) => [c.nationalId, c]));
    const citizenIdOf = new Map<string, string>();
    for (const r of rows) {
      let c = byNid.get(r.nationalId!);
      if (!c) {
        c = await tx.citizen.create({
          data: { distributorId: actor.distributorId, nationalId: r.nationalId!, fullName: r.fullName!, nameNormalized: normalizeName(r.fullName!), phone: r.phone },
        });
        stats.newCitizens++;
      }
      const primaryId = c.mergedIntoId ?? c.id;
      if (c.archivedAt && !c.mergedIntoId) {
        await tx.citizen.update({ where: { id: c.id }, data: { archivedAt: null } });
        stats.restoredCitizens++;
      }
      citizenIdOf.set(r.nationalId!, primaryId);
    }

    // 2) الاستحقاقات.
    const prevEnts = prev ? await tx.entitlement.findMany({ where: { statementId: prev.id, status: "ACTIVE" } }) : [];
    const prevByCitizen = new Map(prevEnts.map((e) => [e.citizenId, e]));
    const keep = new Set<string>();
    // أرقام المواطنين قد تتبادل بين الإصدارات؛ نحرر الأرقام المتغيرة أولًا لتجنب تعارض القيد الفريد المؤقت.
    const plans = rows.map((r) => {
      const citizenId = citizenIdOf.get(r.nationalId!)!;
      const amountDue = effectiveAmount(r, price);
      return { r, citizenId, amountDue, amountSource: r.amount ? ("AUTHORITY" as const) : ("COMPUTED" as const), existing: prevByCitizen.get(citizenId) };
    });
    for (const p of plans) {
      if (p.existing && p.existing.citizenNumber !== p.r.citizenNumber) {
        await tx.entitlement.update({ where: { id: p.existing.id }, data: { citizenNumber: `~${p.existing.id}` } });
      }
    }
    for (const e of prevEnts) {
      if (!plans.some((p) => p.citizenId === e.citizenId)) {
        await tx.entitlement.update({ where: { id: e.id }, data: { status: "REMOVED" } });
        await tx.entitlementChange.create({
          data: { distributorId: actor.distributorId, entitlementId: e.id, source: "REMOVED", statementId: st.id, before: { status: "ACTIVE" }, after: { status: "REMOVED" }, reason: "لم يرد في الإصدار الجديد للكشف", userId: actor.userId },
        });
        stats.removed++;
      }
    }
    for (const p of plans) {
      const fields = {
        citizenNumber: p.r.citizenNumber!,
        nameInStatement: p.r.fullName!,
        phoneInStatement: p.r.phone,
        quantity: p.r.quantity!,
        amountDue: p.amountDue,
        amountSource: p.amountSource,
        unitPrice: price,
      };
      if (p.existing) {
        keep.add(p.existing.id);
        const before = { citizenNumber: p.existing.citizenNumber, nameInStatement: p.existing.nameInStatement, phoneInStatement: p.existing.phoneInStatement, quantity: p.existing.quantity, amountDue: p.existing.amountDue.toFixed(2), amountSource: p.existing.amountSource, unitPrice: p.existing.unitPrice.toFixed(2) };
        const after = { ...fields, amountDue: p.amountDue.toFixed(2), unitPrice: price.toFixed(2) };
        const changed = JSON.stringify(before) !== JSON.stringify(after);
        await tx.entitlement.update({ where: { id: p.existing.id }, data: { ...fields, statementId: st.id } });
        if (changed) {
          await tx.entitlementChange.create({ data: { distributorId: actor.distributorId, entitlementId: p.existing.id, source: "STATEMENT_UPDATE", statementId: st.id, before, after, userId: actor.userId } });
          stats.updated++;
        } else stats.unchanged++;
      } else {
        await tx.entitlement.create({
          data: {
            distributorId: actor.distributorId, cycleId: cycle.id, citizenId: p.citizenId, statementId: st.id,
            currencyCode: cycle.currencyCode, ...fields,
          },
        });
        stats.created++;
      }
    }

    // 3) حالة الكشوف.
    if (prev) {
      await tx.statement.update({ where: { id: prev.id }, data: { status: "SUPERSEDED" } });
      await log(tx, actor, "superseded", prev.id, { status: "SUPERSEDED", by: st.id }, { status: "APPROVED" });
    }
    await tx.statement.update({ where: { id: st.id }, data: { status: "APPROVED", approvedAt: now, approvedById: actor.userId } });
    await log(tx, actor, "approve", st.id, { ...stats, cycleId: cycle.id, supersedes: prev?.id ?? null, diff: diff ? { added: diff.added.length, changed: diff.changed.length, removed: diff.removed.length } : null });
    return stats;
  }, { timeout: 120_000 }).catch((e) => {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new AppError("CONFLICT", "تعارض: مواطن أو رقم مواطن له استحقاق نشط آخر في هذه الدورة. أعد فتح الكشف للمراجعة");
    }
    throw e;
  });
}

// ---------------------------------------------------------------------------
// حذف كشف معتمد (سحبه)
// ---------------------------------------------------------------------------

/** عدد الأشخاص في كل كشف ممن عليهم أثر فعلي: تسليم، أو قبض، أو جرار مسجّلة. */
export async function statementActivity(actor: Actor, statementIds: string[]) {
  assertDistributor(actor);
  if (!statementIds.length) return new Map<string, number>();
  return withTenant(actor.distributorId, async (tx) => {
    const rows = await tx.$queryRaw<{ statementId: string; n: bigint }[]>`
      SELECT e."statementId", count(*) AS n FROM "entitlements" e
      WHERE e."statementId" = ANY(${statementIds}::uuid[]) AND e."status" = 'ACTIVE' AND (
        EXISTS (SELECT 1 FROM "payments" p WHERE p."entitlementId" = e."id" AND p."status" = 'ACTIVE')
        OR EXISTS (SELECT 1 FROM "handovers" h WHERE h."entitlementId" = e."id" AND h."status" = 'ACTIVE')
        OR EXISTS (SELECT 1 FROM "cylinders" z WHERE z."entitlementId" = e."id" AND z."status" <> 'VOID')
      ) GROUP BY 1`;
    return new Map(rows.map((r) => [r.statementId, Number(r.n)]));
  });
}

/**
 * حذف كشف معتمد اعتُمد بالخطأ: يُعلَّم «ملغى» مع السبب، ويُزال ناسه من الاستحقاقات (يبقى كل ذلك في السجل).
 * يُرفض إن كان لأي شخص فيه تسليم أو قبض أو جرار (الحل: «تبديل» بكشف جديد)، أو كان تحديثًا لكشف سابق،
 * أو له تحديث بانتظار الاعتماد.
 */
export async function withdrawStatement(actor: Actor, statementId: string, input: unknown) {
  assertDistributor(actor);
  const { reason } = z.object({ reason: z.string().trim().min(3, "يرجى كتابة السبب").max(500) }).parse(input);
  return withTenant(actor.distributorId, async (tx) => {
    const st = await lockStatement(tx, statementId);
    if (st.status !== "APPROVED") throw new AppError("INVALID_STATE", "يمكن حذف كشف معتمد فقط؛ الكشف بانتظار الاعتماد يُلغى من صفحته");
    if (st.supersedesId) throw new AppError("INVALID_STATE", "هذا الكشف تحديث لكشف سابق؛ استخدم «تبديل» لرفع نسخة صحيحة بدلًا من حذفه");
    if (await tx.statement.count({ where: { supersedesId: st.id, status: "PENDING_REVIEW" } })) {
      throw new AppError("INVALID_STATE", "عندك تحديث لهذا الكشف بانتظار الاعتماد؛ احذف التحديث أولًا");
    }
    const ents = await tx.entitlement.findMany({ where: { statementId: st.id, status: "ACTIVE" }, select: { id: true } });
    const ids = ents.map((e) => e.id);
    const busy = ids.length
      ? await tx.entitlement.count({
          where: {
            id: { in: ids },
            OR: [
              { payments: { some: { status: "ACTIVE" } } },
              { handovers: { some: { status: "ACTIVE" } } },
              { cylinders: { some: { status: { not: "VOID" } } } },
            ],
          },
        })
      : 0;
    if (busy) {
      throw new AppError("INVALID_STATE", `لا يمكن حذف الكشف: فيه ${busy} شخص استلموا أو دفعوا. بدّله بكشف جديد بدلًا من حذفه، فيبقى سجلهم محفوظًا`);
    }
    if (ids.length) {
      await tx.entitlement.updateMany({ where: { id: { in: ids } }, data: { status: "REMOVED" } });
      await tx.entitlementChange.createMany({
        data: ids.map((id) => ({
          distributorId: actor.distributorId, entitlementId: id, source: "STATEMENT_WITHDRAWN", statementId: st.id,
          before: { status: "ACTIVE" }, after: { status: "REMOVED" }, reason, userId: actor.userId,
        })),
      });
    }
    await tx.statement.update({ where: { id: st.id }, data: { status: "DISCARDED", discardedAt: new Date(), discardedById: actor.userId, discardReason: reason } });
    await log(tx, actor, "withdraw", st.id, { status: "DISCARDED", removed: ids.length }, { status: "APPROVED" }, reason);
    return { removed: ids.length };
  });
}

// ---------------------------------------------------------------------------
// سعر الجرة في الكشف
// ---------------------------------------------------------------------------

/** مجموع الجرار والمبلغ المطلوب في الكشف (الصفوف غير المستبعدة): مبلغ الكشف إن ورد، وإلا العدد × سعر الجرة. */
export async function statementDue(actor: Actor, statementId: string) {
  assertDistributor(actor);
  return withTenant(actor.distributorId, async (tx) => {
    const [r] = await tx.$queryRaw<{ cylinders: bigint | null; total: Prisma.Decimal | null; price: Prisma.Decimal | null }[]>`
      SELECT sum(COALESCE(r."quantity", 0)) AS cylinders,
        sum(COALESCE(r."amount", COALESCE(r."quantity", 0) * COALESCE(s."unitPrice", c."unitPrice", 0))) AS total,
        COALESCE(s."unitPrice", c."unitPrice") AS price
      FROM "statements" s
      LEFT JOIN "cycles" c ON c."id" = s."cycleId"
      LEFT JOIN "statement_rows" r ON r."statementId" = s."id" AND NOT r."excluded"
      WHERE s."id" = ${statementId}::uuid
      GROUP BY s."unitPrice", c."unitPrice"`;
    if (!r) throw notFound("الكشف");
    return { cylinders: Number(r.cylinders ?? 0), total: new Prisma.Decimal(r.total ?? 0).toFixed(2), price: r.price ? new Prisma.Decimal(r.price).toFixed(2) : null };
  });
}

const costSchema = z.object({ costPrice: priceSchema.nullable().or(z.literal("").transform(() => null)) });

/**
 * سعر الجرة على الموزّع (تكلفته) في كشف: يُعدَّل في أي وقت قبل الاعتماد أو بعده،
 * لأنه لا يغيّر المطلوب من الناس، بل يحسب ربح الموزّع فقط.
 */
export async function setStatementCost(actor: Actor, statementId: string, input: unknown) {
  assertDistributor(actor);
  const v = costSchema.parse(input ?? {});
  return withTenant(actor.distributorId, async (tx) => {
    const st = await lockStatement(tx, statementId);
    if (st.status !== "PENDING_REVIEW" && st.status !== "APPROVED") throw new AppError("INVALID_STATE", "الكشف قديم أو ملغى");
    const before = st.costPrice?.toFixed(2) ?? null;
    const after = v.costPrice?.toFixed(2) ?? null;
    if (before === after) return { id: st.id, costPrice: after };
    await tx.statement.update({ where: { id: st.id }, data: { costPrice: v.costPrice } });
    await log(tx, actor, "cost", st.id, { costPrice: after }, { costPrice: before });
    return { id: st.id, costPrice: after };
  });
}

/** آخر سعر جرة على الموزّع استُخدم (لتعبئة الحقل عند رفع كشف جديد). */
export async function lastStatementCost(actor: Actor) {
  assertDistributor(actor);
  return withTenant(actor.distributorId, async (tx) => {
    const last = await tx.statement.findFirst({ where: { status: { not: "DISCARDED" }, costPrice: { not: null } }, orderBy: { importedAt: "desc" }, select: { costPrice: true } });
    return last?.costPrice?.toFixed(2) ?? null;
  });
}

/** آخر سعر جرة استُخدم (لتعبئة حقل السعر عند رفع كشف جديد): آخر كشف غير ملغى، وإلا سعر الدورة النشطة. */
export async function lastStatementPrice(actor: Actor) {
  assertDistributor(actor);
  return withTenant(actor.distributorId, async (tx) => {
    const last = await tx.statement.findFirst({ where: { status: { not: "DISCARDED" }, unitPrice: { not: null } }, orderBy: { importedAt: "desc" }, select: { unitPrice: true } });
    if (last?.unitPrice) return last.unitPrice.toFixed(2);
    const active = await getActiveCycle(tx);
    return active ? active.unitPrice.toFixed(2) : null;
  });
}
