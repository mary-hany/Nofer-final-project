# Nofer — تقسيم الـ Backend و الـ Frontend

تم تقسيم ملفّين رئيسيين إلى 4 أجزاء لكل واحد علشان يبقى أسهل في الشرح،
مع الحفاظ الكامل على نفس الـ Functionality.

---

## Backend (PHP)

كان: `backend.php` (1441 سطر) ← بقى:

| الملف | الوصف | الأسطر تقريباً |
|------|------|------|
| `backend.php` | **Wrapper** — يجمع الأجزاء الأربعة في `try/catch/finally` واحد | 64 |
| `backend_1_setup.php` | الإعدادات + CORS + الدوال المساعدة (`json_response`, `require_auth`, `clean_string`, إلخ) | 217 |
| `backend_2_database.php` | تهيئة قاعدة البيانات (إنشاء الجداول، الـ migrations، الـ seed data) | 388 |
| `backend_3_public_routes.php` | كل الـ endpoints العامة وللمستخدمين: `/api/doctors`, `/api/login`, `/api/bookings`, إلخ | 514 |
| `backend_4_admin_routes.php` | كل الـ endpoints الخاصة بالأدمن: `/api/admin/*` | 470 |

**الـ URL لم يتغيّر** — الـ frontend لسه بيستخدم `./backend.php` زي ما هو.
الـ wrapper بيعمل `require` للأجزاء التانية بالترتيب جوّا `try` block.

---

## Frontend (JavaScript)

كان: `script.js` (2121 سطر) ← بقى:

| الملف | الوصف | الأسطر تقريباً |
|------|------|------|
| `script_1_notify_auth.js` | نظام الـ Toast notifications + بيانات أولية + State + `auth` client (token, login, fetch wrapper) | 399 |
| `script_2_modals_render.js` | مودالز تسجيل الدخول/التسجيل + Auth UI في الـ header + رندر التخصصات والأطباء والعيادات | 319 |
| `script_3_booking_profile.js` | مودال الحجز + حقول الدفع + ملف الطبيب + التقييمات | 996 |
| `script_4_reminders_init.js` | نظام التذكيرات + صفحة "حجوزاتي" + `DOMContentLoaded` (تشغيل التطبيق) | 618 |

تم تحديث `index.html` لتحميل الأربع ملفات بالترتيب الصحيح (مهم!) بدل
`script.js` الواحد:

```html
<script src="script_1_notify_auth.js" defer></script>
<script src="script_2_modals_render.js" defer></script>
<script src="script_3_booking_profile.js" defer></script>
<script src="script_4_reminders_init.js" defer></script>
```

`defer` بيخلي المتصفح يستنى لحد ما الـ HTML يخلص قبل تنفيذ السكربتات،
وفي نفس الوقت بيحافظ على ترتيب التنفيذ بينهم.

---

## كل ملف فيه

- **هيدر بالعربي في الأول** بيشرح الجزء ده بيعمل إيه ومحتوياته الرئيسية.
- **الكود الأصلي لم يتغيّر** — مفيش refactor، بس تقسيم.
- **PHP**: كل جزء فيه `<?php` في الأول. الـ wrapper بيستدعيهم بـ `require`
  والمتغيرات بتنتقل بشكل طبيعي بين الأجزاء (مثل `$db`, `$path`, `$method`).
- **JS**: كل جزء فيه `'use strict';` في الأول. التحميل بالترتيب يضمن
  إن المتغيرات والدوال المعرّفة في الجزء الأول متاحة للأجزاء التالية.

---

## التحقق من سلامة التقسيم

- ✅ كل ملف PHP عدّى `php -l` بدون أخطاء.
- ✅ كل ملف JS عدّى `node --check` بدون أخطاء.
- ✅ تم اختبار الـ wrapper فعلياً على قاعدة البيانات:
  - `GET /api/doctors` → رجّع قائمة الأطباء.
  - `GET /api/clinics` → رجّع قائمة العيادات.
  - `GET /api/notfound` → رجّع 404 بشكل صحيح.
