import { createHash } from "node:crypto";
import type { FileKind } from "@prisma/client";
import type { Tx } from "../db";
import { withTenant } from "../db";
import { notFound } from "../errors";
import { type Actor, assertDistributor } from "../actor";

/**
 * تخزين الملفات. التنفيذ الحالي يحفظ المحتوى داخل PostgreSQL (file_blobs) إلى حين اعتماد
 * مزوّد تخزين سحابي؛ عندها يُضاف تنفيذ بديل هنا دون تغيير بقية النظام.
 * كل ملف مرتبط بموزّع، ولا يُقرأ إلا عبر سياق ذلك الموزّع (RLS)، ولا توجد له روابط عامة.
 */
export const sha256Hex = (data: Buffer) => createHash("sha256").update(data).digest("hex");

export async function storeFile(
  tx: Tx,
  actor: Actor & { distributorId: string },
  f: { kind: FileKind; name: string; mime: string; data: Buffer; sha256?: string },
) {
  const file = await tx.storedFile.create({
    data: {
      distributorId: actor.distributorId,
      kind: f.kind,
      originalName: f.name.slice(0, 255),
      mimeType: f.mime.slice(0, 120) || "application/octet-stream",
      size: f.data.length,
      sha256: f.sha256 ?? sha256Hex(f.data),
      storage: "db",
      createdById: actor.userId,
    },
  });
  await tx.fileBlob.create({ data: { fileId: file.id, distributorId: actor.distributorId, data: new Uint8Array(f.data) } });
  return file;
}

/** قراءة ملف للموزّع صاحبه فقط. */
export async function readOwnFile(actor: Actor, fileId: string) {
  assertDistributor(actor);
  return withTenant(actor.distributorId, async (tx) => {
    const file = await tx.storedFile.findUnique({ where: { id: fileId }, include: { blob: true } });
    if (!file || !file.blob) throw notFound("الملف");
    return { name: file.originalName, mime: file.mimeType, data: Buffer.from(file.blob.data) };
  });
}
