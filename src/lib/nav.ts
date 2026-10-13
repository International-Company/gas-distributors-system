import type { Actor } from "@/server/actor";
import { hasPermission } from "@/server/actor";
import type { AdminPermission } from "@/server/permissions";

export type NavIcon = "home" | "users" | "tags" | "shield" | "history" | "login" | "bug" | "settings" | "user";
export type NavItem = { href: string; label: string; icon: NavIcon };

type Def = NavItem & { permission?: AdminPermission; superAdmin?: boolean };

const ADMIN_NAV: Def[] = [
  { href: "/admin", label: "لوحة التحكم", icon: "home" },
  { href: "/admin/distributors", label: "الموزّعون", icon: "users", permission: "distributors.view" },
  { href: "/admin/categories", label: "التصنيفات", icon: "tags", permission: "distributors.view" },
  { href: "/admin/admins", label: "مديرو النظام", icon: "shield", superAdmin: true },
  { href: "/admin/audit", label: "سجل التدقيق", icon: "history", permission: "audit.view" },
  { href: "/admin/login-attempts", label: "محاولات الدخول", icon: "login", permission: "audit.view" },
  { href: "/admin/errors", label: "سجل الأخطاء", icon: "bug", permission: "errors.view" },
  { href: "/admin/settings", label: "الإعدادات", icon: "settings", permission: "settings.manage" },
  { href: "/account", label: "حسابي", icon: "user" },
];

const DISTRIBUTOR_NAV: Def[] = [
  { href: "/d", label: "الرئيسية", icon: "home" },
  { href: "/account", label: "حسابي", icon: "user" },
];

/** عناصر القائمة المسموحة للمستخدم. الإخفاء هنا للتنظيم فقط؛ الحماية الفعلية على الخادم. */
export function navFor(actor: Actor): NavItem[] {
  const defs = actor.role === "ADMIN" ? ADMIN_NAV : DISTRIBUTOR_NAV;
  return defs
    .filter((d) => (d.superAdmin ? actor.isSuperAdmin : d.permission ? hasPermission(actor, d.permission) : true))
    .map(({ href, label, icon }) => ({ href, label, icon }));
}
