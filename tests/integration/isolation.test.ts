import { describe, expect, it } from "vitest";
import { appDb, withSystem, withTenant } from "@/server/db";
import { audit } from "@/server/audit";
import { getDistributor, getOwnDistributor, listDistributors } from "@/server/services/distributors";
import { listAuditLogs } from "@/server/services/logs";
import { makeAdmin, makeDistributor, ownerDb } from "../helpers/factories";

describe("عزل بيانات الموزّعين (RLS في قاعدة البيانات)", () => {
  it("سياق الموزّع يرى صفه فقط ولا يرى الموزّعين الآخرين", async () => {
    const a = await makeDistributor();
    const b = await makeDistributor();
    const seen = await withTenant(a.distributor.id, (tx) => tx.distributor.findMany());
    expect(seen.map((d) => d.id)).toEqual([a.distributor.id]);
    const other = await withTenant(a.distributor.id, (tx) => tx.distributor.findUnique({ where: { id: b.distributor.id } }));
    expect(other).toBeNull();
  });

  it("سياق الموزّع لا يرى مستخدمي موزّع آخر ولا حسابات المديرين", async () => {
    const a = await makeDistributor();
    await makeDistributor();
    await makeAdmin({ superAdmin: true });
    const users = await withTenant(a.distributor.id, (tx) => tx.user.findMany());
    expect(users.map((u) => u.id)).toEqual([a.user.id]);
  });

  it("سياق الموزّع لا يستطيع تعديل صف موزّع آخر", async () => {
    const a = await makeDistributor();
    const b = await makeDistributor();
    const res = await withTenant(a.distributor.id, (tx) =>
      tx.distributor.updateMany({ where: { id: b.distributor.id }, data: { name: "اختراق" } }),
    );
    expect(res.count).toBe(0);
    const fresh = await ownerDb.distributor.findUniqueOrThrow({ where: { id: b.distributor.id } });
    expect(fresh.name).toBe(b.distributor.name);
  });

  it("سياق الموزّع لا يستطيع إدراج سجل تدقيق باسم موزّع آخر", async () => {
    const a = await makeDistributor();
    const b = await makeDistributor();
    await expect(
      withTenant(a.distributor.id, (tx) => audit(tx, a.actor, { action: "x", entityType: "x", distributorId: b.distributor.id })),
    ).rejects.toThrow();
  });

  it("فشل مغلق: الاستعلام دون سياق لا يرى أي صف من الجداول المعزولة", async () => {
    await makeDistributor();
    expect(await appDb.distributor.count()).toBe(0);
    expect(await appDb.user.count()).toBe(0);
  });

  it("السياق المركزي يرى كل الموزّعين", async () => {
    const a = await makeDistributor();
    const b = await makeDistributor();
    const ids = (await withSystem((tx) => tx.distributor.findMany())).map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining([a.distributor.id, b.distributor.id]));
  });

  it("الموزّع لا يستطيع استدعاء خدمات الإدارة", async () => {
    const a = await makeDistributor();
    const b = await makeDistributor();
    await expect(listDistributors(a.actor, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getDistributor(a.actor, b.distributor.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listAuditLogs(a.actor, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("الموزّع يقرأ ملفه فقط حتى لو تلاعب بالمعرّف في هويته", async () => {
    const a = await makeDistributor();
    const b = await makeDistributor();
    expect((await getOwnDistributor(a.actor)).id).toBe(a.distributor.id);
    // لو حاول طرف تمرير معرّف موزّع آخر مع مستخدم مختلف، فـ RLS يقصر الرؤية على السياق.
    const forged = { ...a.actor, distributorId: b.distributor.id };
    const seenUsers = await withTenant(forged.distributorId!, (tx) => tx.user.findMany({ where: { id: a.user.id } }));
    expect(seenUsers).toHaveLength(0);
  });
});

describe("حماية سجل التدقيق والسجلات", () => {
  it("دور التطبيق لا يستطيع تعديل أو حذف سجل التدقيق", async () => {
    const { actor } = await makeAdmin({ superAdmin: true });
    await withSystem((tx) => audit(tx, actor, { action: "test.entry", entityType: "test" }));
    const row = await ownerDb.auditLog.findFirstOrThrow({ where: { action: "test.entry" } });
    await expect(withSystem((tx) => tx.auditLog.update({ where: { id: row.id }, data: { action: "changed" } }))).rejects.toThrow();
    await expect(withSystem((tx) => tx.auditLog.delete({ where: { id: row.id } }))).rejects.toThrow();
  });

  it("حتى مالك قاعدة البيانات يُمنع من التعديل والحذف بواسطة trigger", async () => {
    const row = await ownerDb.auditLog.create({ data: { action: "owner.test", entityType: "test" } });
    await expect(ownerDb.auditLog.update({ where: { id: row.id }, data: { action: "x" } })).rejects.toThrow(/محمي/);
    await expect(ownerDb.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/محمي/);
    await expect(ownerDb.$executeRawUnsafe('TRUNCATE "audit_logs"')).rejects.toThrow(/محمي/);
  });

  it("سجل محاولات الدخول للإضافة فقط", async () => {
    const row = await withSystem((tx) => tx.loginAttempt.create({ data: { username: "x", success: false, method: "PASSWORD" } }));
    await expect(withSystem((tx) => tx.loginAttempt.delete({ where: { id: row.id } }))).rejects.toThrow();
  });

  it("سجل التدقيق لا يحفظ الأسرار", async () => {
    const { actor } = await makeAdmin({ superAdmin: true });
    await withSystem((tx) =>
      audit(tx, actor, { action: "secret.test", entityType: "t", after: { passwordHash: "SECRET", pin: "1234", ok: 1 } }),
    );
    const row = await ownerDb.auditLog.findFirstOrThrow({ where: { action: "secret.test" } });
    expect(row.after).toEqual({ ok: 1 });
  });
});
