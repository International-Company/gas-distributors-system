# نظام إدارة موزّعي الغاز

منصة ويب مركزية لإدارة موزّعي الغاز في قطاع غزة: حساب مستقل ومعزول لكل موزّع، وإدارة مركزية لمديري النظام.

> **حالة المشروع:** المراحل 1 إلى 6 منفذة (الأساس والأمان، الكشوف والمواطنون والدورات، الجرار والمخزون، المالية، التقارير والتصدير والإعدادات، التطبيق القابل للتثبيت والعمل دون اتصال). المرحلتان التاليتان (الإعلانات والرسائل والدعم، الاختبارات النهائية) لم تُنفذا بعد. التفاصيل في تقارير المراحل داخل [docs/](docs/).

## التقنيات

- Next.js 15 (App Router) و React 19 و TypeScript
- PostgreSQL 17 عبر Prisma 6 (ترحيلات حقيقية `prisma migrate`)
- Tailwind CSS 4 (واجهة عربية RTL، وضع فاتح وداكن)
- Argon2id لتجزئة كلمات المرور وPIN
- Vitest لاختبارات التكامل على قاعدة PostgreSQL حقيقية
- الاستضافة: Railway

## المتطلبات

- Node.js 20 أو أحدث (يُنصح بـ 22)
- PostgreSQL 17 (عبر Docker أو تثبيت محلي)

## التشغيل محليًا

```bash
git clone https://github.com/International-Company/gas-distributors-system.git
cd gas-distributors-system
npm install
cp .env.example .env        # ثم عدّل كلمات المرور
```

### قاعدة البيانات

**الخيار 1: Docker** (يتطلب Docker Desktop مع WSL2):

```bash
npm run db:up               # PostgreSQL على المنفذ 5433 + قاعدة gas_test للاختبارات
```

**الخيار 2: PostgreSQL مثبت محليًا:** أنشئ قاعدتي `gas` و `gas_test` بمستخدم مالك، وعدّل الروابط في `.env`.

ثم طبّق الترحيلات وجهّز دور التطبيق:

```bash
npm run db:deploy           # prisma migrate deploy + إنشاء الدور gas_app وصلاحياته
npm run admin:create -- --username admin --name "المدير الرئيسي"
```

يطبع الأمر الأخير كلمة مرور مؤقتة **مرة واحدة**، ويُلزم المدير بتغييرها عند أول دخول.

### تشغيل التطبيق

```bash
npm run dev                 # وضع التطوير: http://localhost:3000
# أو للإنتاج محليًا:
npm run build && npm start
```

## متغيرات البيئة

| المتغير | الوصف |
|---|---|
| `DATABASE_URL` | اتصال **مالك** قاعدة البيانات. يُستخدم للترحيلات وإنشاء دور التطبيق فقط |
| `APP_DATABASE_URL` | اتصال التطبيق أثناء التشغيل بالدور `gas_app` محدود الصلاحيات |
| `APP_DB_PASSWORD` | كلمة مرور الدور `gas_app` (12 حرفًا على الأقل)، يجب أن تطابق ما في `APP_DATABASE_URL` |
| `TEST_DATABASE_URL` / `TEST_APP_DATABASE_URL` | للاختبارات فقط. يجب أن ينتهي اسم القاعدة بـ `_test` |

ملف `.env.example` خالٍ من الأسرار. **لا ترفع ملف `.env` إلى GitHub أبدًا** (مستثنى في `.gitignore`).

## الاختبارات

```bash
npm test                    # كل الاختبارات (تعيد بناء قاعدة gas_test من الترحيلات)
npm run typecheck
```

الاختبارات تعمل على قاعدة `gas_test` فقط، وترفض التشغيل إن لم ينتهِ اسم القاعدة بـ `_test`.

## النشر على Railway

1. أنشئ مشروعًا على Railway وأضف خدمة **PostgreSQL**.
2. أضف خدمة من مستودع GitHub هذا (الإعدادات في `railway.json`).
3. اضبط متغيرات الخدمة:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `APP_DB_PASSWORD` = كلمة مرور قوية عشوائية
   - `APP_DATABASE_URL` = نفس رابط Postgres مع استبدال المستخدم وكلمة المرور بـ `gas_app` و `APP_DB_PASSWORD`
     (مثال: `postgresql://gas_app:<APP_DB_PASSWORD>@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}`)
4. عند كل تشغيل ينفذ `npm start` السكربت `scripts/predeploy.mjs`: يطبّق الترحيلات المعتمدة ويجهّز دور `gas_app`، ثم يشغّل الخادم. يتوقف التشغيل إن فشل أي منهما.
5. أنشئ المدير الأول **داخل الحاوية** (عنوان قاعدة البيانات الداخلي غير متاح من جهازك، لذلك لا يعمل `railway run`):
   ```bash
   railway ssh -- sh -c 'npx tsx scripts/create-admin.ts --username admin --name "المدير الرئيسي"'
   ```

> النشر الحالي: https://gas-distributors-system-production.up.railway.app (مشروع Railway: fortunate-empathy). التحقق الكامل من النشر، ومنه النسخ الاحتياطي، مجدول في المرحلة 8.

## النسخ الاحتياطي

- لا يتضمن التطبيق نظام نسخ احتياطي خاصًا به (حسب المواصفات).
- يوفر Railway نسخًا احتياطية لخدمات PostgreSQL حسب الخطة. يجب تفعيلها والتحقق منها من لوحة Railway، **والتحقق دوريًا من إمكانية الاستعادة** على قاعدة منفصلة.
- نسخ قاعدة البيانات **لا تشمل الملفات**. آلية نسخ الملفات ستُوثّق عند اعتماد مزوّد التخزين السحابي.

## تحديث النظام

1. ادمج التغييرات في الفرع الرئيسي على GitHub؛ ينشرها Railway تلقائيًا.
2. الترحيلات الجديدة تُطبّق تلقائيًا عند التشغيل عبر `prisma migrate deploy`، الذي لا يحذف بيانات ولا يعيد ضبط القاعدة.
3. لا تستخدم `prisma db push` أو `prisma migrate reset` على قاعدة الإنتاج.

## معالجة الأخطاء الشائعة

| المشكلة | الحل |
|---|---|
| `APP_DATABASE_URL غير محدد` | أضف المتغير إلى `.env` أو متغيرات Railway |
| `permission denied for table ...` | شغّل `npm run db:deploy` لإعادة منح صلاحيات `gas_app` بعد ترحيل جديد |
| لا تظهر أي بيانات رغم وجودها | التطبيق متصل بالدور الصحيح لكن خارج سياق `withTenant/withSystem` (عزل RLS يعمل بفشل مغلق) |
| Docker لا يعمل على Windows | فعّل WSL2 و Virtual Machine Platform، أو استخدم PostgreSQL مثبتًا محليًا |
| `Cannot find native binding` عند البناء | تأكد أن Node.js 20+ |

## التوثيق

- [docs/architecture.md](docs/architecture.md): البنية، العزل، الأمان، القرارات التقنية
- [docs/api.md](docs/api.md): واجهات API
- [docs/phase-1-report.md](docs/phase-1-report.md) و [docs/phase-2-report.md](docs/phase-2-report.md): تقارير المراحل ونتائج الاختبارات
