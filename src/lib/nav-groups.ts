// أنواع القائمة الجانبية ومجموعاتها، دون أي اعتماد على الخادم (تستوردها مكونات المتصفح).

export type NavIcon = "home" | "users" | "tags" | "shield" | "history" | "login" | "bug" | "settings" | "user" | "calendar" | "file" | "search" | "merge" | "alert" | "counter" | "cylinder" | "truck" | "warehouse" | "factory" | "wallet" | "banknote" | "receipt" | "chart" | "sync";
/** مجموعات القائمة الجانبية بترتيب ظهورها. «main» بلا عنوان، و«account» تظهر في بطاقة المستخدم أسفل القائمة. */
export type NavGroup = "main" | "work" | "records" | "stock" | "money" | "insight" | "people" | "oversight" | "system" | "account";
export const NAV_GROUPS: { key: NavGroup; label: string | null }[] = [
  { key: "main", label: null },
  { key: "work", label: "العمل اليومي" },
  { key: "records", label: "الكشوف والمواطنون" },
  { key: "stock", label: "الجرار والمخزون" },
  { key: "money", label: "المالية" },
  { key: "people", label: "إدارة الموزّعين" },
  { key: "oversight", label: "الرقابة والتقارير" },
  { key: "insight", label: "التقارير" },
  { key: "system", label: "النظام" },
  { key: "account", label: null },
];
export type NavItem = { href: string; label: string; icon: NavIcon; group: NavGroup };
