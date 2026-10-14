import type { Actor } from "@/server/actor";
import { hasPermission } from "@/server/actor";
import type { AdminPermission } from "@/server/permissions";

export type NavIcon = "home" | "users" | "tags" | "shield" | "history" | "login" | "bug" | "settings" | "user" | "calendar" | "file" | "search" | "merge" | "alert" | "counter" | "cylinder" | "truck" | "warehouse" | "factory" | "wallet" | "banknote" | "receipt" | "chart";
export type NavItem = { href: string; label: string; icon: NavIcon };

type Def = NavItem & { permission?: AdminPermission; superAdmin?: boolean };

const ADMIN_NAV: Def[] = [
  { href: "/admin", label: "لوحة التحكم", icon: "home" },
  { href: "/admin/distributors", label: "الموزّعون", icon: "users", permission: "distributors.view" },
  { href: "/admin/categories", label: "التصنيفات", icon: "tags", permission: "distributors.view" },
  { href: "/admin/admins", label: "مديرو النظام", icon: "shield", superAdmin: true },
  { href: "/admin/reports", label: "التقارير", icon: "chart", permission: "reports.view" },
  { href: "/admin/audit", label: "سجل التدقيق", icon: "history", permission: "audit.view" },
  { href: "/admin/login-attempts", label: "محاولات الدخول", icon: "login", permission: "audit.view" },
  { href: "/admin/errors", label: "سجل الأخطاء", icon: "bug", permission: "errors.view" },
  { href: "/admin/settings", label: "الإعدادات", icon: "settings", permission: "settings.manage" },
  { href: "/account", label: "حسابي", icon: "user" },
];

const DISTRIBUTOR_NAV: Def[] = [
  { href: "/d", label: "الرئيسية", icon: "home" },
  { href: "/d/counter", label: "الشباك", icon: "counter" },
  { href: "/d/citizens", label: "المواطنون", icon: "search" },
  { href: "/d/cylinders", label: "الجرار", icon: "cylinder" },
  { href: "/d/shipments", label: "الشحنات", icon: "truck" },
  { href: "/d/inventory", label: "المخزون", icon: "warehouse" },
  { href: "/d/finance", label: "الصندوق", icon: "wallet" },
  { href: "/d/collections", label: "التحصيلات", icon: "banknote" },
  { href: "/d/expenses", label: "المصروفات", icon: "receipt" },
  { href: "/d/reports", label: "التقارير", icon: "chart" },
  { href: "/d/statements", label: "الكشوف", icon: "file" },
  { href: "/d/cycles", label: "الدورات", icon: "calendar" },
  { href: "/d/stations", label: "المحطات", icon: "factory" },
  { href: "/d/review-cases", label: "حالات المراجعة", icon: "alert" },
  { href: "/d/merge", label: "اقتراحات الدمج", icon: "merge" },
  { href: "/account", label: "حسابي", icon: "user" },
];

/** تخصيص مدير النظام لأسماء الأقسام وترتيبها وإخفائها (من الإعدادات). */
export type NavOverrides = Record<string, { label?: string; order?: number; hidden?: boolean }>;

/** أقسام لا يجوز إخفاؤها حتى لا يُحجب الوصول إلى الإعدادات أو الحساب. */
export const NAV_LOCKED = new Set(["/admin", "/admin/settings", "/d", "/account"]);

/** كل الأقسام المعرفة مع القائمة التي تنتمي لها (لشاشة الإعدادات). */
export const ALL_NAV = [
  ...ADMIN_NAV.map((d) => ({ href: d.href, label: d.label, menu: "admin" as const })),
  ...DISTRIBUTOR_NAV.filter((d) => d.href !== "/account").map((d) => ({ href: d.href, label: d.label, menu: "distributor" as const })),
];

/** عناصر القائمة المسموحة للمستخدم. الإخفاء هنا للتنظيم فقط؛ الحماية الفعلية على الخادم. */
export function navFor(actor: Actor, overrides: NavOverrides = {}): NavItem[] {
  const defs = actor.role === "ADMIN" ? ADMIN_NAV : DISTRIBUTOR_NAV;
  return defs
    .map((d, i) => ({ d, i, o: overrides[d.href] ?? {} }))
    .filter(({ d, o }) => (d.superAdmin ? actor.isSuperAdmin : d.permission ? hasPermission(actor, d.permission) : true) && (!o.hidden || NAV_LOCKED.has(d.href)))
    // الترتيب المحدد صراحة يتقدم عند التساوي مع الموضع الافتراضي لقسم آخر.
    .sort((a, b) => (a.o.order ?? a.i) - (b.o.order ?? b.i) || Number(b.o.order !== undefined) - Number(a.o.order !== undefined) || a.i - b.i)
    .map(({ d, o }) => ({ href: d.href, label: o.label?.trim() || d.label, icon: d.icon }));
}
