# واجهات API (الإصدار v1)

- كل الواجهات تحت `/api/v1` وتتبادل JSON.
- المصادقة بملف تعريف الارتباط `gas_session` (يُضبط عند الدخول).
- كل طلب معدِّل (`POST/PATCH/DELETE`) يجب أن يحمل ترويسة `Origin` مطابقة للمضيف.
- النجاح: `{"data": ...}`
- الفشل: `{"error": {"code": "...", "message": "رسالة عربية", "fields": {"اسم_الحقل": "الخطأ"}}}`

| الرمز | HTTP | المعنى |
|---|---|---|
| `UNAUTHENTICATED` | 401 | لا توجد جلسة صالحة أو بيانات اعتماد خاطئة |
| `FORBIDDEN` | 403 | لا صلاحية، أو حساب معلّق/منتهٍ/مؤرشف |
| `REAUTH_REQUIRED` | 403 | عملية حساسة: أكد كلمة المرور عبر `/auth/reauth` ثم أعد الطلب |
| `PASSWORD_CHANGE_REQUIRED` | 403 | يجب تغيير كلمة المرور أولًا |
| `VALIDATION` | 400 | بيانات غير صالحة (`fields` يحدد الحقول) |
| `NOT_FOUND` | 404 | غير موجود |
| `CONFLICT` | 409 | تعارض (اسم مستخدم مكرر مثلًا) |
| `INVALID_STATE` | 409 | العملية لا تناسب الحالة الحالية |
| `RATE_LIMITED` | 429 | قفل مؤقت أو محاولات كثيرة |
| `INTERNAL` | 500 | خطأ غير متوقع (يُسجل في سجل الأخطاء) |

## المصادقة `/auth`

| الطريقة والمسار | الجسم | الوصف |
|---|---|---|
| `POST /auth/login` | `{username, password}` | يرجع `{mustChangePassword}` ويضبط الجلسة |
| `POST /auth/pin-login` | `{pin}` | دخول بـ PIN على جهاز مرتبط |
| `POST /auth/logout` | — | إنهاء الجلسة الحالية |
| `POST /auth/reauth` | `{password}` | تأكيد كلمة المرور للعمليات الحساسة (صالح 15 دقيقة) |
| `POST /auth/change-password` | `{currentPassword, newPassword, confirmPassword}` | يبطل الجلسات الأخرى |
| `POST /auth/pin` | `{password, pin, confirmPin}` | تفعيل PIN على هذا الجهاز |
| `DELETE /auth/pin` | — | إلغاء PIN هذا الجهاز |
| `POST /auth/logout-all` | — | حساس: خروج من كل الأجهزة وإلغاء كل PIN |
| `GET /auth/me` | — | بيانات المستخدم الحالي |

## الموزّع `/distributor`

| الطريقة والمسار | الوصف |
|---|---|
| `GET /distributor/profile` | ملف الموزّع الحالي (عبر سياق RLS معزول) |

## الإدارة `/admin`

| الطريقة والمسار | الصلاحية | الوصف |
|---|---|---|
| `GET /admin/distributors` | `distributors.view` | فلاتر: `q, status (ACTIVE/SUSPENDED/EXPIRED/ARCHIVED/ALL), categoryId, trial (yes/no), pinned (yes), expiringDays` |
| `POST /admin/distributors` | `distributors.manage` | `{name, username, password, phone, region, categoryId?, isTrial, expiresAt?}` |
| `GET /admin/distributors/export` | `distributors.export` | ملف Excel بالفلاتر نفسها |
| `GET /admin/distributors/:id` | `distributors.view` | |
| `PATCH /admin/distributors/:id` | `distributors.manage` | `{name?, username?, phone?, region?, categoryId?}` |
| `POST /admin/distributors/:id/actions` | حسب العملية | انظر الجدول التالي |
| `GET/POST /admin/categories` | عرض / `categories.manage` | `{name}` |
| `PATCH/DELETE /admin/categories/:id` | `categories.manage` | الحذف لتصنيف غير مستخدم فقط |
| `GET/POST /admin/admins` | مدير رئيسي (+ تأكيد كلمة المرور للإنشاء) | `{username, displayName, phone?, password, isSuperAdmin, permissions[]}` |
| `GET/PATCH /admin/admins/:id` | مدير رئيسي | `{displayName?, phone?, isSuperAdmin?, permissions?}` |
| `POST /admin/admins/:id/actions` | مدير رئيسي | `suspend {reason}`، `activate`، `reset-password {newPassword, reason}`، `logout-all {reason}`، `unlock` |
| `GET /admin/audit` | `audit.view` | فلاتر: `action, distributorId, actorUserId, from, to, page` |
| `GET /admin/login-attempts` | `audit.view` | فلاتر: `username, success (yes/no), from, to, page` |
| `GET /admin/errors` | `errors.view` | `from, to, page` |
| `GET/PATCH /admin/settings` | `settings.manage` | |

### عمليات حساب الموزّع (`POST /admin/distributors/:id/actions`)

| `action` | الحقول | الصلاحية |
|---|---|---|
| `suspend` | `reason` | `distributors.status` |
| `activate` | `isTrial, expiresAt?, reason?` | `distributors.status` |
| `set-validity` | `isTrial, expiresAt?, reason?` (تمديد، تحويل التجريبي إلى فعلي، إلغاء المدة) | `distributors.status` |
| `archive` / `unarchive` | `reason` | `distributors.status` |
| `pin` / `unpin` | — | `distributors.manage` |
| `reset-password` | `newPassword, reason, revokeSessions` (حساس) | `distributors.credentials` |
| `logout-all` | `reason` | `distributors.credentials` |
| `unlock` | — | `distributors.credentials` |

## عامة

| الطريقة والمسار | الوصف |
|---|---|
| `GET /settings/public` | اسم النظام وبيانات التواصل والعملة (تستخدم أيضًا لفحص صحة الخدمة على Railway) |

---

# المرحلة 2: واجهات الموزّع (الدورات، الكشوف، المواطنون)

كلها تتطلب جلسة موزّع، وتعمل داخل سياق الموزّع المعزول (RLS). أي معرّف لا يخص الموزّع يرجع `NOT_FOUND`.

## الدورات

| الطريقة والمسار | الجسم | الوصف |
|---|---|---|
| `GET /cycles` | — | الدورات مع عدد المستحقين والجرار والمطلوب |
| `POST /cycles` | `{name?, unitPrice}` | دورة جديدة؛ تُرفض بوجود دورة نشطة |
| `GET /cycles/:id` | — | ملخص الدورة وسجلها وكشوفها |
| `POST /cycles/:id/actions` | `{action:"close", confirm:true}` | إغلاق؛ يُرفض بوجود كشف قيد المراجعة |
| | `{action:"reopen", reason}` | إعادة فتح؛ يُرفض بوجود دورة نشطة أخرى |
| | `{action:"price", unitPrice, reason}` | تعديل السعر للدورة النشطة؛ لا يغيّر المبالغ المعتمدة |

## الكشوف

| الطريقة والمسار | الجسم | الوصف |
|---|---|---|
| `GET /statements` | `?status=&cycleId=` | القائمة مع أعداد الصفوف السليمة والتنبيهات والأخطاء |
| `POST /statements` | multipart: `file`, `title?`, `supersedesId?` | رفع واستخراج؛ يرجع `{id, duplicateOf[], needsOcr}` |
| `GET /statements/:id` | `?severity=OK\|WARNING\|ERROR\|EXCLUDED&q=&page=` | التفاصيل والصفوف والفروق مع الإصدار السابق |
| `PATCH /statements/:id` | `{title?, cycleId?, supersedesId?}` | قيد المراجعة فقط |
| `PUT /statements/:id/mapping` | `{headerRow, mapping:{nationalId, fullName, citizenNumber, quantity, amount, phone}}` | يعيد استخراج الصفوف |
| `PATCH /statements/:id/rows/:rowId` | `{nationalId?, fullName?, phone?, citizenNumber?, quantity?, amount?, excluded?}` | تصحيح أو استبعاد صف |
| `POST /statements/:id/ocr` | `{items:[{text,x,y,w,h,page}], confidence}` | نتيجة القراءة الضوئية من المتصفح |
| `POST /statements/:id/approve` | `{confirm:true}` | الاعتماد الصريح |
| `POST /statements/:id/discard` | `{reason}` | إلغاء قبل الاعتماد (يبقى محفوظًا) |
| `GET /statements/:id/file` | — | الملف الأصلي، لصاحبه فقط |

## المواطنون والاستحقاقات

| الطريقة والمسار | الجسم | الوصف |
|---|---|---|
| `GET /citizens/search` | `?q=&by=auto\|name\|nationalId\|phone\|citizenNumber&includeArchived=1` | البحث |
| `GET /citizens/:id` | — | الملف: الاستحقاقات حسب الدورة، الإجمالي، السجل الزمني |
| `POST /citizens/:id/archive` | `{archived}` | أرشفة أو استعادة |
| `GET/POST /citizens/archive-ended` | — | عدد القابلين للأرشفة / أرشفتهم دفعة واحدة |
| `GET /citizens/merge-suggestions` | — | اقتراحات الدمج |
| `POST /citizens/merge-suggestions` | `{citizenAId, citizenBId}` | رفض اقتراح |
| `POST /citizens/merge` | `{primaryId, secondaryId, reason}` | دمج بقرار بشري |
| `PATCH /entitlements/:id` | `{citizenNumber?, quantity?, amountDue?, nameInStatement?, reason}` | تعديل استحقاق معتمد في الدورة النشطة |
| `GET/POST /review-cases` | `{nationalId?, fullName?, phone?, details}` | حالات المراجعة |
| `POST /review-cases/:id/resolve` | `{resolution}` | إغلاق الحالة |

---

# المرحلة 3: الجرار والمخزون والشحنات (واجهات الموزّع)

**منع التكرار:** كل عملية تحمل `clientOpId` يولده الجهاز (UUID). إعادة الإرسال بالمعرّف نفسه، ولو بالتزامن، ترجع نتيجة العملية الأولى مع `replayed: true` دون تنفيذ جديد. المعرّف نفسه لعملية مختلفة يرجع `CONFLICT`.

**التحقق من الهوية:** `nationalId` هو رقم البطاقة كما أُدخل أو قُرئ وأكده المستخدم، و`identityMethod` هو `MANUAL_ENTRY` أو `ID_SCAN`. عند عدم المطابقة تُرفض العملية بـ `IDENTITY_MISMATCH`، وتُسجل حالة مراجعة تلقائيًا.

| الطريقة والمسار | الجسم | الوصف |
|---|---|---|
| `GET /counter/lookup` | `?nationalId=` | الشباك: المواطن واستحقاقاته العاملة وجراره |
| `POST /operations/receive-empty` | `{clientOpId, entitlementId, nationalId, identityMethod}` | استلام جرة فارغة: +1 فارغ |
| `POST /operations/fill` | `{items:[{clientOpId, cylinderId}]}` | تعبئة فردية أو جماعية (كلها أو لا شيء): −1 فارغ +1 معبأ |
| `POST /operations/deliver` | `{clientOpId, cylinderId, cylinderLabel, nationalId, identityMethod}` | تسليم: −1 معبأ |
| `POST /operations/:id/cancel` | `{reason}` | إلغاء آخر عملية نافذة على الجرة، مع عكس أثرها مرة واحدة |
| `GET /cylinders` | `?status=EMPTY\|FILLED\|DELIVERED\|VOID&cycleId=&q=&page=&pageSize=` | قائمة الجرار |
| `GET /cylinders/:id` | — | الجرة وسجل عملياتها |
| `GET/POST /stations` | `{name, phone?, notes?}` | المحطات |
| `PATCH /stations/:id` | `{name?, phone?, notes?, active?}` | تعديل أو تعطيل محطة |
| `GET /shipments` | `?stationId=&page=` | الشحنات |
| `POST /shipments` | `{clientOpId, stationId, quantity, cylinderIds[], receivedAt?, reference?, notes?}` | استلام شحنة: تعبئة الجرار المختارة، والباقي كمية إضافية |
| `GET /shipments/:id` | — | الشحنة وجرارها |
| `POST /shipments/:id/cancel` | `{reason}` | إلغاء الشحنة (يُرفض إن سُلّمت إحدى جرارها) |
| `GET /inventory` | — | الرصيد ومطابقته بحالات الجرار |
| `GET /inventory/movements` | `?type=&from=&to=&page=` | سجل حركة المخزون |

---

# المرحلة 4: المالية (واجهات الموزّع)

المبالغ نصوص عشرية بمنزلتين (مثل `"15.50"`). كل إنشاء يحمل `clientOpId` لمنع التكرار. السجلات المالية لا تُعدّل ولا تُحذف؛ التصحيح بالإلغاء المسبب ثم سجل جديد.

| الطريقة والمسار | الجسم | الوصف |
|---|---|---|
| `POST /payments` | `{clientOpId, entitlementId, full:true}` أو `{…, amount}` + `paidAt?, notes?` | تحصيل كامل المتبقي أو جزئي؛ يُرفض ما يتجاوز المتبقي |
| `GET /payments` | `?cycleId=&status=&from=&to=&page=` | التحصيلات وإجمالي النافذ |
| `POST /payments/:id/cancel` | `{reason}` | إلغاء تحصيل (مرة واحدة) |
| `POST /expenses` | `{clientOpId, amount, description, spentAt?}` | مصروف |
| `GET /expenses` | `?from=&to=&page=` | المصروفات |
| `POST /expenses/:id/cancel` | `{reason}` | إلغاء مصروف |
| `POST /station-payments` | `{clientOpId, stationId, amount, paidAt?, reference?, notes?}` | دفعة لمحطة |
| `POST /station-payments/:id/cancel` | `{reason}` | إلغاء دفعة محطة |
| `GET /stations/accounts` | — | قيمة الشحنات والمدفوع والمتبقي لكل محطة |
| `GET /stations/:id/account` | `?from=&to=` | كشف حساب محطة: رصيد افتتاحي وحركات برصيد جارٍ |
| `GET /cash-box` | `?from=&to=&cycleId=` | الصندوق: المقبوضات والمصروفات ودفعات المحطات والرصيد المحسوب |

تعديلات على واجهات سابقة:
- `POST /shipments` يقبل `unitPrice` (سعر شراء الجرة لهذه الشحنة). إن غاب يُستخدم `defaultUnitPrice` للمحطة، وإن لم يوجد تُرفض الشحنة.
- `POST/PATCH /stations` يقبلان `defaultUnitPrice`.
- `GET /counter/lookup` يعيد لكل استحقاق `paid` و `amountRemaining` و `canPay`، ويعيد للمواطن `totalRemaining`.

---

# المرحلة 5: التقارير والتصدير والإعدادات

| الطريقة والمسار | الصلاحية | الوصف |
|---|---|---|
| `GET /reports` | أي مستخدم | قائمة التقارير وفلاترها |
| `GET /reports/:key` | الموزّع لبياناته؛ المدير بـ `reports.view` مع `distributorId` | تشغيل تقرير (JSON) |
| `GET /reports/:key/xlsx` | كالسابق | تصدير Excel (يُسجل في التدقيق) |
| `GET /admin/central` | `reports.view` | الملخص المركزي لكل موزّع (`?categoryId=&includeArchived=1`) |
| `GET /admin/central/xlsx` | `reports.view` | تصدير الملخص المركزي |
| `PUT /admin/settings/nav` | `settings.manage` | `{ "/d/counter": { label, order, hidden } }` |
| `POST/DELETE /admin/settings/logo` | `settings.manage` | رفع الشعار (multipart `file`: PNG/JPEG/WebP ≤ 512KB) أو إزالته |
| `GET /settings/logo` | عام | الشعار |
| `PATCH /admin/settings` | `settings.manage` | يقبل أيضًا `allowedFileTypes[]` و `maxUploadMb` (1–50) |

مفاتيح التقارير: `citizens-sheet` (`cycleId, state`)، `not-delivered` (`cycleId`)، `unpaid` (`cycleId?`)، `empty-not-filled` و `filled-not-delivered` (`cycleId?`)، `operations-period` (`from, to, type`)، `cycles-comparison`، `collections` (`cycleId?, from, to`)، `expenses` و `cash-box` و `inventory` (`from, to`)، `stations`، `statements` (`cycleId?`). التواريخ `YYYY-MM-DD` بتوقيت غزة.

الطباعة وحفظ PDF: صفحات `/print/reports/:key` و `/print/central` بالفلاتر نفسها، تفتح نافذة الطباعة في المتصفح.
