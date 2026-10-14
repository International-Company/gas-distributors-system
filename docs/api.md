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
