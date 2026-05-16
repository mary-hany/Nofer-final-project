<?php
// ============================================================
// الملف الرئيسي (Wrapper) — Nofer Backend API
// ============================================================
//
// الملف ده مهمته بسيطة: يجمع الأجزاء الأربعة في تسلسل صحيح ويربطهم
// ببلوك try/catch/finally واحد بحيث أي خطأ في أي جزء يتمسك هنا.
//
// التسلسل المنطقي:
//
//   1) backend_1_setup.php       : الإعدادات + الـ CORS headers + الدوال المساعدة.
//      (لازم يتحمّل الأول علشان كل الباقي بيستخدم دواله مثل
//       json_response و require_auth و clean_string ... إلخ).
//
//   2) داخل try { ... }:
//      2.a) backend_2_database.php       : إنشاء الجداول و الـ migrations
//                                          و الـ seed data، وبيعرّف $db.
//      2.b) backend_3_public_routes.php  : كل الـ endpoints العامة وللمستخدمين.
//      2.c) backend_4_admin_routes.php   : كل الـ endpoints الخاصة بالأدمن.
//
//   3) لو طلع برّا كل الـ if-routes من غير ما حد يرد على الطلب،
//      ده معناه إن الـ endpoint مش موجود → 404.
//
//   4) catch : لو حصل أي Exception (مشكلة في الـ DB، خطأ Type، إلخ)
//             يتم تسجيله في error log ويرجع 500 للمستخدم.
//
//   5) finally: يقفل الاتصال بالـ DB.
//
// الـ URL النهائي اللي بيستخدمه الـ frontend هو ./backend.php زي ما هو،
// مفيش أي تغيير محتاج في الـ frontend.
// ============================================================

declare(strict_types=1);

// --- 1) تحميل الإعدادات والدوال المساعدة ---
require __DIR__ . '/backend_1_setup.php';

// --- 2) معالجة الطلب داخل try/catch ---
try {
    // 2.a) قاعدة البيانات: إنشاء الجداول و الـ seed (بيعرّف $db)
    require __DIR__ . '/backend_2_database.php';

    // 2.b) المسارات العامة وللمستخدمين
    //      (هذا الجزء بيعرّف $path و $method من الـ URL ثم بيرد على
    //       الـ Endpoints الـ public و bookings و reviews ... إلخ).
    require __DIR__ . '/backend_3_public_routes.php';

    // 2.c) مسارات الأدمن
    require __DIR__ . '/backend_4_admin_routes.php';

    // 3) مفيش route اتطابق → 404
    json_response(404, ['success' => false, 'error' => 'Not found']);

} catch (Throwable $e) {
    // 4) أي خطأ غير متوقّع → 500
    error_log('[nofer] ' . $e->getMessage());
    json_response(500, ['success' => false, 'error' => 'Internal server error']);
} finally {
    // 5) قفل الاتصال بالـ DB
    if (isset($db)) $db->close();
}
