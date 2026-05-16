<?php
// ============================================================
// الجزء الأول من الـ Backend: الإعدادات والدوال المساعدة
// ============================================================

declare(strict_types=1); // تفعيل وضع التدقيق الصارم لأنواع البيانات لضمان عدم حدوث أخطاء غير متوقعة

// ---------- الإعدادات العامة (Configuration) ----------

// قائمة النطاقات (Domains) المسموح لها بإرسال طلبات للسيرفر
const ALLOWED_ORIGINS = [
    'http://localhost',
    'http://localhost:8000',
    'http://127.0.0.1',
    'http://127.0.0.1:8000',
    'http://localhost:5500',     
    'http://127.0.0.1:5500',   
];

const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 30; // حساب مدة صلاحية الجلسة بالثواني (تعادل 30 يوماً)
const LOGIN_RATE_LIMIT_WINDOW   = 60 * 15;           // الفترة الزمنية المحددة لحظر المحاولات الفاشلة (15 دقيقة)
const LOGIN_RATE_LIMIT_MAX     = 10;                // الحد الأقصى للمحاولات الخاطئة المسموح بها لكل عنوان IP خلال الـ 15 دقيقة
const ALLOWED_PAYMENT_METHODS  = ['visa', 'fawry', 'paypal', 'vodafone_cash', 'cash']; // قائمة طرق الدفع المعتمدة في النظام

// ---------- إعدادات الهيدرز و الـ CORS (حماية تبادل البيانات بين النطاقات) ----------

// جلب رابط الموقع (Origin) الذي أرسل الطلب، وإذا لم يكن موجوداً نضع قيمة فارغة
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';

// التحقق مما إذا كان موقع المرسل موجوداً ضمن القائمة المسموح لها (ALLOWED_ORIGINS)
if ($origin !== '' && in_array($origin, ALLOWED_ORIGINS, true)) {
    header('Access-Control-Allow-Origin: ' . $origin); // السماح لهذا الموقع بالتحديد بقراءة البيانات
    header('Access-Control-Allow-Credentials: true');  // السماح بإرسال الكوكيز وجلسات العمل عبر المتصفح
    header('Vary: Origin'); // إخبار المتصفحات والـ Caching servers أن الرد يختلف باختلاف الموقع المرسل
}

// تحديد العمليات (Methods) المسموح للمتصفح تنفيذها على الـ API
header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
// تحديد الهيدرز المسموح للمتصفح إرسالها (مثل نوع البيانات وتوكن التحقق)
header('Access-Control-Allow-Headers: Content-Type, Authorization');
// تحديد نوع البيانات الراجعة من السيرفر على أنها JSON وترميزها UTF-8 لدعم اللغة العربية
header('Content-Type: application/json; charset=utf-8');
// منع المتصفح من تخمين نوع الملفات لحماية الموقع من هجمات حقن الملفات الخبيثة
header('X-Content-Type-Options: nosniff');

// التعامل مع طلبات OPTIONS (وهي طلبات وهمية يرسلها المتصفح تلقائياً للتأكد من صلاحيات الـ CORS قبل إرسال الطلب الفعلي)
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204); // الرد بكود 204 (نجاح بدون محتوى)
    exit(0); // إنهاء التنفيذ فوراً دون استهلاك موارد السيرفر
}

// ---------- الدوال المساعدة (Helpers) ----------

/**
 * دالة لتوحيد صيغة الردود الراجعة من السيرفر وتحويلها إلى JSON
 */
function json_response(int $status, array $payload): void {
    http_response_code($status); // تحديد كود الحالة (مثل 200 للنجاح، 400 للخطأ، 401 لغير المسجلين)
    echo json_encode($payload, JSON_UNESCAPED_UNICODE); // تحويل المصفوفة لـ JSON مع الحفاظ على الحروف العربية دون تشفيرها
    exit; // إيقاف السيرفر عن العمل تماماً بعد إرسال الرد
}

/**
 * دالة لقراءة البيانات القادمة في جسم الطلب (Request Body) وتحويلها لمصفوفة PHP
 */
function read_json_body(): array {
    $raw = file_get_contents('php://input'); // قراءة البيانات الخام القادمة من الـ Frontend (مثل بيانات الفورم)
    if ($raw === false || $raw === '') return []; // إذا كانت البيانات فارغة نرجع مصفوفة فارغة
    $data = json_decode($raw, true); // تحويل نص الـ JSON إلى مصفوفة PHP تفاعلية
    return is_array($data) ? $data : []; // التأكد أن النتيجة مصفوفة فعلاً، وإذا لم تكن نرجع مصفوفة فارغة
}

/**
 * دالة لحساب طول النصوص بشكل دقيق وآمن حتى مع الحروف العربية والرموز التعبيرية
 */
function str_length(string $value): int {
    // إذا كانت دالة mb_strlen متوفرة بالسيرفر نستخدمها لأنها تدعم الـ UTF-8 بشكل ممتاز
    if (function_exists('mb_strlen')) return mb_strlen($value, 'UTF-8');
    // حل بديل باستخدام التعبيرات القياسية (RegEx) لحساب عدد الحروف في حال غياب الدالة السابقة
    return preg_match_all('/./u', $value);
}

/**
 * دالة لتنظيف النصوص المدخلة من المستخدم والتحقق من سلامتها وطولها
 */
function clean_string($value, int $maxLen, bool $allowEmpty = false): ?string {
    if ($value === null) return $allowEmpty ? '' : null; // إذا كانت القيمة فارغة تماماً نرى هل مسموح بالفراغ أم لا
    if (!is_string($value)) return null; // إذا لم يكن المدخل نصاً (مصفوفة أو رقم مثلاً) نرفضه
    $value = trim($value); // إزالة الفراغات الزائدة من بداية والنهاية النص
    if ($value === '') return $allowEmpty ? '' : null; // التحقق من النص بعد حذف الفراغات
    if (str_length($value) > $maxLen) return null; // التأكد أن طول النص لا يتعدى الحد الأقصى المسموح به في قاعدة البيانات
    // فحص النص لمنع وجود حروف تحكم مخفية (Control Characters) والتي تستخدم في هجمات الاختراق
    if (preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', $value)) return null;
    return $value; // إرجاع النص نظيفاً وجاهزاً للاستخدام
}

/**
 * دالة للتحقق من صحة صيغة البريد الإلكتروني وطوله
 */
function valid_email(string $email): bool {
    // استخدام فلاتر PHP الجاهزة لفحص الإيميل والتأكد أن طوله لا يتعدى 200 حرف
    return (bool) filter_var($email, FILTER_VALIDATE_EMAIL) && str_length($email) <= 200;
}

/**
 * دالة للتحقق من صحة رقم الهاتف (يقبل علامة + اختياري متبوعة بـ 7 إلى 15 رقم)
 */
function valid_phone(string $phone): bool {
    return (bool) preg_match('/^\+?[0-9]{7,15}$/', $phone);
}

/**
 * دالة للتحقق من أن التاريخ المرسل صحيح وصيغته (YYYY-MM-DD) وأنه ليس في الماضي
 */
function valid_date(string $date): bool {
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) return false; // التأكد من الشكل الخارجي للتاريخ
    $d = DateTime::createFromFormat('Y-m-d', $date); // محاولة تحويل النص إلى كائن تاريخ حقيقي
    if (!$d || $d->format('Y-m-d') !== $date) return false; // التأكد أن التاريخ حقيقي (مثلاً لا يوجد يوم 32 في الشهر)
    return $d >= new DateTime('today'); // التأكد أن التاريخ يبدأ من اليوم أو مستقبلي (ممنوع الحجز بتاريخ قديم)
}

/**
 * دالة لجلب عنوان الـ IP الخاص بجهاز المستخدم الحالي بشكل آمن
 */
function client_ip(): string {
    // الاعتماد فقط على REMOTE_ADDR لضمان عدم تزييف الـ IP من قبل المستخدم
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}

/**
 * دالة لتوليد توكن عشوائي وقوي جداً لاستخدامه في جلسات تسجيل الدخول
 */
function generate_token(): string {
    return bin2hex(random_bytes(32)); // توليد 32 بايت عشوائي وتشفيرهم بصيغة Hex لينتج نص بطول 64 حرفاً
}

/**
 * دالة لتشفير التوكن عبر خوارزمية SHA-256 قبل حفظه في قاعدة البيانات لحماية المستخدمين
 */
function hash_token(string $token): string {
    return hash('sha256', $token); // تحويل التوكن لهاش غير قابل للتفكيك، لحماية الجلسات في حال تسريب قاعدة البيانات
}

/**
 * دالة لاستخراج توكن الجلسة (Bearer Token) القادم من الـ Frontend عبر الهيدرز
 */
function bearer_token(): ?string {
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? ''; // محاولة جلب الهيدر القياسي للتوكن
    // إذا لم يجده (بعض السيرفرات مثل Apache تقوم بحذفه)، نحاول جلب الهيدرز بطريقة بديلة
    if ($auth === '' && function_exists('apache_request_headers')) {
        $h = apache_request_headers();
        $auth = $h['Authorization'] ?? $h['authorization'] ?? '';
    }
    // استخدام الـ RegEx للتأكد أن الهيدر يبدأ بكلمة Bearer متبوعة بالتوكن المكون من 64 حرفاً
    if (preg_match('/^Bearer\s+([A-Fa-f0-9]{64})$/', $auth, $m)) return $m[1];
    return null; // إذا لم يجد توكن مطابق يعيد فارغ
}

/**
 * دالة لجلب بيانات المستخدم الحالي من قاعدة البيانات بناءً على التوكن المرسل
 */
function current_user(SQLite3 $db): ?array {
    $token = bearer_token(); // جلب التوكن من الهيدر
    if ($token === null) return null; // إذا لم يرسل توكن، يعني أنه غير مسجل دخول

    // تجهيز استعلام SQL آمن للبحث عن الجلسة وصاحبها (يحمي من الـ SQL Injection)
    $stmt = $db->prepare(
        'SELECT 
            u.id,
            u.name,
            u.email,
            u.phone,
            u.is_admin
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?
           AND s.expires_at > strftime("%s","now") -- التأكد أن الجلسة لم تنتهِ صلاحيتها بعد
         LIMIT 1'
    );

    // ربط قيمة الهاش الخاصة بالتوكن بالاستعلام بشكل آمن
    $stmt->bindValue(1, hash_token($token), SQLITE3_TEXT);

    // تنفيذ الاستعلام وجلب النتيجة كمصفوفة مفتاح وقيمة (Assoc)
    $row = $stmt->execute()->fetchArray(SQLITE3_ASSOC);

    return $row ?: null; // إرجاع بيانات المستخدم إذا وُجدت، أو null إن لم توجد
}

/**
 * دالة تجبر السيرفر على إيقاف العملية وإرجاع خطأ 401 إذا كان الزائر غير مسجل دخول
 */
function require_auth(SQLite3 $db): array {
    $user = current_user($db); // فحص المستخدم الحالي
    if (!$user) json_response(401, ['success' => false, 'error' => 'Authentication required']); // طرد الزائر إذا لم تكن هناك جلسة صالحة
    return $user; // إرجاع بيانات المستخدم إذا كان مسجلاً بالفعل
}

/**
 * دالة تجبر السيرفر على فحص صلاحيات الأدمن (المدير)، وتطرد أي مستخدم عادي بخطأ 403
 */
function require_admin(SQLite3 $db): array {
    $user = require_auth($db); // التأكد أولاً أنه مسجل دخول
    if ((int)($user['is_admin'] ?? 0) !== 1) { // التحقق من حقل الـ Admin في قاعدة البيانات
        json_response(403, ['success' => false, 'error' => 'يتطلب صلاحيات المدير']); // طرد المستخدم لو مش أدمن
    }
    return $user; // إرجاع بيانات الأدمن
}

/**
 * دالة تفحص ما إذا كان هذا الـ IP قد تجاوز الحد المسموح له من محاولات تسجيل الدخول الخاطئة
 */
function login_is_throttled(SQLite3 $db, string $ip): bool {
    $cutoff = time() - LOGIN_RATE_LIMIT_WINDOW; // حساب نقطة بداية الـ 15 دقيقة الماضية
    // استعلام لمعرفة عدد المحاولات الفاشلة من هذا الـ IP في هذه الفترة
    $stmt = $db->prepare('SELECT COUNT(*) AS c FROM login_attempts WHERE ip = ? AND attempted_at > ?');
    $stmt->bindValue(1, $ip, SQLITE3_TEXT);
    $stmt->bindValue(2, $cutoff, SQLITE3_INTEGER);
    $row = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    // يعيد true (يعني اقفل الحساب مؤقتاً) لو عدد المحاولات الفاشلة يساوي أو أكبر من 10
    return ((int) ($row['c'] ?? 0)) >= LOGIN_RATE_LIMIT_MAX;
}

/**
 * دالة لتسجيل محاولة دخول فاشلة في قاعدة البيانات لحساب الـ Rate Limit
 */
function record_failed_login(SQLite3 $db, string $ip): void {
    $stmt = $db->prepare('INSERT INTO login_attempts (ip, attempted_at) VALUES (?, ?)');
    $stmt->bindValue(1, $ip, SQLITE3_TEXT);
    $stmt->bindValue(2, time(), SQLITE3_INTEGER); // تسجيل وقت المحاولة الحالي (Timestamp)
    $stmt->execute();
}

/**
 * دالة لتصفير وحذف المحاولات الفاشلة للـ IP بعد نجاحه في تسجيل الدخول
 */
function clear_failed_logins(SQLite3 $db, string $ip): void {
    $stmt = $db->prepare('DELETE FROM login_attempts WHERE ip = ?');
    $stmt->bindValue(1, $ip, SQLITE3_TEXT);
    $stmt->execute();
}

/**
 * دالة لإنشاء جلسة جديدة (Session) للمستخدم بعد تسجيل دخوله بنجاح
 */
function issue_session(SQLite3 $db, int $userId): array {
    $token = generate_token(); // توليد توكن عشوائي جديد للمستخدم
    $now = time(); // الوقت الحالي
    $exp = $now + SESSION_LIFETIME_SECONDS; // وقت انتهاء الجلسة (بعد 30 يوم)
    
    // إدخال الجلسة مشفرة في قاعدة البيانات
    $sess = $db->prepare('INSERT INTO sessions (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)');
    $sess->bindValue(1, $userId, SQLITE3_INTEGER);
    $sess->bindValue(2, hash_token($token), SQLITE3_TEXT); // تخزين الهاش فقط لحماية البيانات
    $sess->bindValue(3, $now, SQLITE3_INTEGER);
    $sess->bindValue(4, $exp, SQLITE3_INTEGER);
    $sess->execute();
    
    // إرجاع التوكن الأصلي (النظيف) للـ Frontend ليقوم بحفظه لديه وإرساله مع كل طلب، مع إرجاع وقت الانتهاء
    return ['token' => $token, 'expires_at' => $exp];
}


// ============================================================
// الجزء الأول من الـ Backend: الإعدادات والدوال المساعدة
// ============================================================
//
// هذا الملف يحتوي على كل التحضيرات الأساسية اللي بيحتاجها السيرفر
// قبل ما يبدأ يستقبل أي طلبات (requests) من الـ frontend.
//
// محتويات الملف:
//   1) الإعدادات العامة (Configuration)
//      - قائمة الـ Origins المسموح لها بالاتصال بالـ API (CORS).
//      - مدة صلاحية الجلسة (Session) — هنا 30 يوم.
//      - حدود محاولات تسجيل الدخول لمنع الـ brute-force.
//      - طرق الدفع المقبولة.
//
//   2) هيدرات الـ CORS و الـ Response
//      - بيسمح للـ frontend (سواء على localhost أو السيرفر) إنه يبعت
//        Cookies و Authorization headers.
//      - بيرد على طلبات OPTIONS (preflight) من المتصفح.
//
//   3) الدوال المساعدة (Helpers)
//      - json_response()  : ترجع رد JSON مع الـ status code.
//      - read_json_body() : تقرأ الـ body بتاع الـ request وتحوّله JSON.
//      - clean_string()   : تنضّف وتتحقق من طول النصوص اللي جاية من المستخدم.
//      - valid_email() / valid_phone() / valid_date() : تحقّقات Validation.
//      - generate_token() / hash_token() : لتوليد توكنات الجلسات وتخزينها
//        بشكل آمن (Hash) في قاعدة البيانات.
//      - bearer_token() / current_user() / require_auth() / require_admin() :
//        مسؤولة عن قراءة الـ Bearer token من الـ Authorization header
//        والتأكد إن المستخدم مسجّل دخول (و أحياناً إنه أدمن).
//      - login_is_throttled() / record_failed_login() / clear_failed_logins() :
//        نظام تحديد المعدّل (Rate Limit) لتسجيل الدخول.
//      - issue_session() : تنشئ جلسة جديدة وترجع توكن للمستخدم.
//
// ملاحظة: الملف ده بيُستدعى أوّل حاجة في الـ wrapper (backend.php) لأن
// كل الأجزاء التانية بتعتمد على الدوال والثوابت اللي معرّفة هنا.