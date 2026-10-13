// صلاحيات مديري النظام. المدير الرئيسي (isSuperAdmin) يملكها كلها،
// وهو وحده من يدير حسابات المديرين وصلاحياتهم.
export const ADMIN_PERMISSIONS = {
  "distributors.view": "عرض حسابات الموزّعين",
  "distributors.manage": "إنشاء حسابات الموزّعين وتعديل بياناتها",
  "distributors.status": "تفعيل الحسابات وتعليقها وأرشفتها وتحديد صلاحيتها",
  "distributors.credentials": "إعادة تعيين كلمات المرور وإنهاء الجلسات",
  "distributors.export": "تصدير قائمة الحسابات",
  "categories.manage": "إدارة تصنيفات الموزّعين",
  "audit.view": "عرض سجل التدقيق ومحاولات الدخول",
  "errors.view": "عرض سجل الأخطاء التقنية",
  "settings.manage": "إدارة إعدادات النظام",
} as const;

export type AdminPermission = keyof typeof ADMIN_PERMISSIONS;
export const ALL_ADMIN_PERMISSIONS = Object.keys(ADMIN_PERMISSIONS) as AdminPermission[];

export function isAdminPermission(p: string): p is AdminPermission {
  return p in ADMIN_PERMISSIONS;
}
