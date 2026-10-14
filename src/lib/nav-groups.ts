// أنواع القائمة الجانبية ومجموعاتها، دون أي اعتماد على الخادم (تستوردها مكونات المتصفح).

export type NavIcon = "home" | "users" | "tags" | "shield" | "history" | "login" | "bug" | "settings" | "user" | "calendar" | "file" | "search" | "merge" | "alert" | "counter" | "cylinder" | "truck" | "warehouse" | "factory" | "wallet" | "banknote" | "receipt" | "chart" | "sync";
/** مجموعات القائمة الجانبية بترتيب ظهورها. «main» بلا عنوان، و«account» تظهر في بطاقة المستخدم أسفل القائمة. */
export type NavGroup = "main" | "work" | "records" | "stock" | "money" | "insight" | "people" | "oversight" | "system" | "account";
export const NAV_GROUPS: { key: NavGroup; label: string | null }[] = [
  { key: "main", label: null },
  { key: "work", label: "شغل اليوم" },
  { key: "records", label: "الناس والكشوفات" },
  { key: "stock", label: "الجرار والمخزن" },
  { key: "money", label: "الفلوس" },
  { key: "people", label: "الموزّعين" },
  { key: "oversight", label: "المتابعة والتقارير" },
  { key: "insight", label: "التقارير" },
  { key: "system", label: "النظام" },
  { key: "account", label: null },
];
export type NavItem = { href: string; label: string; icon: NavIcon; group: NavGroup };
