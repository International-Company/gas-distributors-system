import type { Actor } from "@/server/actor";
import { hasPermission } from "@/server/actor";
import type { AdminPermission } from "@/server/permissions";

import type { NavGroup, NavItem } from "./nav-groups";
import { NAV_GROUPS } from "./nav-groups";
export { NAV_GROUPS, type NavGroup, type NavIcon, type NavItem } from "./nav-groups";

type Def = NavItem & { permission?: AdminPermission; superAdmin?: boolean };

const ADMIN_NAV: Def[] = [
  { href: "/admin", label: "الرئيسية", icon: "home", group: "main" },
  { href: "/admin/distributors", label: "الموزّعين", icon: "users", group: "people", permission: "distributors.view" },
  { href: "/admin/categories", label: "المجموعات", icon: "tags", group: "people", permission: "distributors.view" },
  { href: "/admin/reports", label: "التقارير", icon: "chart", group: "oversight", permission: "reports.view" },
  { href: "/admin/audit", label: "سجل الحركات", icon: "history", group: "oversight", permission: "audit.view" },
  { href: "/admin/login-attempts", label: "مين دخل", icon: "login", group: "oversight", permission: "audit.view" },
  { href: "/admin/errors", label: "الأعطال", icon: "bug", group: "oversight", permission: "errors.view" },
  { href: "/admin/admins", label: "المدراء", icon: "shield", group: "system", superAdmin: true },
  { href: "/admin/settings", label: "الإعدادات", icon: "settings", group: "system", permission: "settings.manage" },
  { href: "/account", label: "حسابي", icon: "user", group: "account" },
];

const DISTRIBUTOR_NAV: Def[] = [
  { href: "/d", label: "الرئيسية", icon: "home", group: "main" },
  { href: "/d/counter", label: "التوزيع", icon: "counter", group: "work" },
  { href: "/d/sync", label: "شغل بدون نت", icon: "sync", group: "work" },
  { href: "/d/citizens", label: "الناس", icon: "search", group: "records" },
  { href: "/d/statements", label: "الكشوفات", icon: "file", group: "records" },
  { href: "/d/cycles", label: "الدورات", icon: "calendar", group: "records" },
  { href: "/d/review-cases", label: "مشاكل بدها حل", icon: "alert", group: "records" },
  { href: "/d/merge", label: "أسماء مكررة", icon: "merge", group: "records" },
  { href: "/d/cylinders", label: "الجرار", icon: "cylinder", group: "stock" },
  { href: "/d/shipments", label: "نقلات المحطة", icon: "truck", group: "stock" },
  { href: "/d/inventory", label: "المخزن", icon: "warehouse", group: "stock" },
  { href: "/d/stations", label: "المحطات", icon: "factory", group: "stock" },
  { href: "/d/finance", label: "الغلّة", icon: "wallet", group: "money" },
  { href: "/d/collections", label: "المقبوض", icon: "banknote", group: "money" },
  { href: "/d/expenses", label: "المصاريف", icon: "receipt", group: "money" },
  { href: "/d/reports", label: "التقارير", icon: "chart", group: "insight" },
  { href: "/account", label: "حسابي", icon: "user", group: "account" },
];

/** تخصيص مدير النظام لأسماء الأقسام وترتيبها وإخفائها (من الإعدادات). */
export type NavOverrides = Record<string, { label?: string; order?: number; hidden?: boolean }>;

/** أقسام لا يجوز إخفاؤها حتى لا يُحجب الوصول إلى الإعدادات أو الحساب. */
export const NAV_LOCKED = new Set(["/admin", "/admin/settings", "/d", "/d/sync", "/account"]);

/** كل الأقسام المعرفة مع القائمة التي تنتمي لها (لشاشة الإعدادات). */
export const ALL_NAV = [
  ...ADMIN_NAV.map((d) => ({ href: d.href, label: d.label, group: d.group, menu: "admin" as const })),
  ...DISTRIBUTOR_NAV.filter((d) => d.href !== "/account").map((d) => ({ href: d.href, label: d.label, group: d.group, menu: "distributor" as const })),
];

const groupIdx = (g: NavGroup) => NAV_GROUPS.findIndex((x) => x.key === g);

/** عناصر القائمة المسموحة للمستخدم. الإخفاء هنا للتنظيم فقط؛ الحماية الفعلية على الخادم. */
export function navFor(actor: Actor, overrides: NavOverrides = {}): NavItem[] {
  const defs = actor.role === "ADMIN" ? ADMIN_NAV : DISTRIBUTOR_NAV;
  return defs
    // i: موضع القسم الافتراضي داخل مجموعته (الترتيب المخصص يعني الموضع داخل المجموعة).
    .map((d) => ({ d, i: defs.filter((x) => x.group === d.group).indexOf(d), o: overrides[d.href] ?? {} }))
    .filter(({ d, o }) => (d.superAdmin ? actor.isSuperAdmin : d.permission ? hasPermission(actor, d.permission) : true) && (!o.hidden || NAV_LOCKED.has(d.href)))
    // المجموعات بترتيبها الثابت، ثم الترتيب داخل المجموعة؛ المحدد صراحة يتقدم عند التساوي مع الموضع الافتراضي لقسم آخر.
    .sort((a, b) =>
      groupIdx(a.d.group) - groupIdx(b.d.group) ||
      (a.o.order ?? a.i) - (b.o.order ?? b.i) ||
      Number(b.o.order !== undefined) - Number(a.o.order !== undefined) ||
      a.i - b.i)
    .map(({ d, o }) => ({ href: d.href, label: o.label?.trim() || d.label, icon: d.icon, group: d.group }));
}
