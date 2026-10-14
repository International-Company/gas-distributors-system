import { afterAll, describe, expect, it } from "vitest";
import { getLogo, getPublicSettings, setLogo, updateNavOverrides, updateSettings } from "@/server/services/settings";
import { createCycle } from "@/server/services/cycles";
import { uploadStatement } from "@/server/services/statements";
import { navFor } from "@/lib/nav";
import { makeAdmin, makeDistributor } from "../helpers/factories";
import { makeStatementXlsx, newId, xlsxFile } from "../helpers/statements";

const base = { systemName: "نظام الغاز", currencyCode: "ILS", currencySymbol: "₪", sessionIdleMinutes: 30, maxFailedLogins: 5, lockoutMinutes: 15 };

describe("إعدادات الملفات", () => {
  afterAll(async () => {
    const { actor } = await makeAdmin({ superAdmin: true });
    await updateSettings(actor, { ...base, allowedFileTypes: ["pdf", "xlsx", "jpg", "jpeg", "png", "webp"], maxUploadMb: 20 });
  });

  it("رفع الكشف يحترم الأنواع المسموحة والحد الأقصى للحجم", async () => {
    const { actor: admin } = await makeAdmin({ superAdmin: true });
    const { actor } = await makeDistributor();
    await createCycle(actor, { unitPrice: "20" });
    const file = xlsxFile(await makeStatementXlsx([{ id: newId(), name: "تجربة", number: 1 }]));

    await updateSettings(admin, { ...base, allowedFileTypes: ["pdf"] });
    await expect(uploadStatement(actor, file, {})).rejects.toThrow(/غير مسموح/);

    await updateSettings(admin, { ...base, allowedFileTypes: ["pdf", "xlsx"], maxUploadMb: 1 });
    const big = { ...file, data: Buffer.concat([file.data, Buffer.alloc(1024 * 1024)]) };
    await expect(uploadStatement(actor, big, {})).rejects.toThrow(/الحد المسموح/);
    await expect(uploadStatement(actor, file, {})).resolves.toBeTruthy();

    await expect(updateSettings(admin, { ...base, maxUploadMb: 500 })).rejects.toThrow();
    await expect(updateSettings(admin, { ...base, allowedFileTypes: ["exe"] })).rejects.toThrow();
  });
});

describe("القائمة الجانبية", () => {
  afterAll(async () => {
    const { actor } = await makeAdmin({ superAdmin: true });
    await updateNavOverrides(actor, {});
  });

  it("تغيير الاسم والترتيب والإخفاء، ومنع إخفاء الأقسام الأساسية", async () => {
    const { actor: admin } = await makeAdmin({ superAdmin: true });
    const { actor: dist } = await makeDistributor();
    await expect(updateNavOverrides(admin, { "/d": { hidden: true } })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(updateNavOverrides(admin, { "/unknown": { label: "x x" } })).rejects.toMatchObject({ code: "VALIDATION" });
    await updateNavOverrides(admin, { "/d/sync": { label: "المزامنة والانقطاع", order: 0 }, "/d/merge": { hidden: true } });
    const s = await getPublicSettings();
    const nav = navFor(dist, s.navOverrides);
    // الترتيب داخل المجموعة: المزامنة صارت أول «العمل اليومي» قبل الشباك، والمجموعات بترتيبها الثابت.
    expect(nav.filter((n) => n.group === "work").map((n) => n.href)).toEqual(["/d/sync", "/d/counter"]);
    expect(nav[0].href).toBe("/d");
    expect(nav.find((n) => n.href === "/d/sync")?.label).toBe("المزامنة والانقطاع");
    expect(nav.some((n) => n.href === "/d/merge")).toBe(false);
    // الإخفاء تنظيمي فقط: الصفحة نفسها محمية بالصلاحيات لا بالقائمة.
    const { actor: limited } = await makeAdmin({ permissions: ["settings.manage"] });
    await expect(updateNavOverrides(limited, {})).resolves.toBeUndefined();
    const { actor: noPerm } = await makeAdmin({ permissions: ["audit.view"] });
    await expect(updateNavOverrides(noPerm, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("الشعار", () => {
  it("يقبل PNG ويرفض SVG والملفات المتنكرة والكبيرة", async () => {
    const { actor } = await makeAdmin({ superAdmin: true });
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
    await expect(setLogo(actor, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(setLogo(actor, Buffer.concat([png, Buffer.alloc(600 * 1024)]))).rejects.toMatchObject({ code: "VALIDATION" });
    await setLogo(actor, png);
    const l = await getLogo();
    expect(l?.logoMime).toBe("image/png");
    expect((await getPublicSettings()).logoUrl).toMatch(/\/api\/v1\/settings\/logo/);
    await setLogo(actor, null);
    expect((await getPublicSettings()).logoUrl).toBeNull();
  });
});
