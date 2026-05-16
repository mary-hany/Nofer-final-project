<?php
// ============================================================
// الجزء الرابع من الـ Backend: مسارات لوحة التحكم (Admin Routes)
// ============================================================

    // ------------------------------------------------------------
    // مسار: إعادة تعيين كلمة مرور الأدمن (POST /api/admin/reset-admin-password)
    // ------------------------------------------------------------
    if ($path === '/api/admin/reset-admin-password' && $method === 'POST') {
        $email = 'admin@nofer.local'; // تحديد البريد الإلكتروني الافتراضي للمدير
        $newHash = password_hash('admin123', PASSWORD_DEFAULT); // تشفير كلمة المرور الافتراضية أمنياً

        // استعلام للتأكد مما إذا كان حساب المدير هذا موجوداً مسبقاً في قاعدة البيانات أم لا
        $exists = $db->querySingle("SELECT id FROM users WHERE email = '$email'");
        
        if ($exists) {
            // إذا كان الحساب موجوداً: يتم تحديث كلمة المرور وضمان تفعيل صلاحية الأدمن (is_admin = 1)
            $upd = $db->prepare('UPDATE users SET password_hash = ?, is_admin = 1 WHERE email = ?');
            $upd->bindValue(1, $newHash, SQLITE3_TEXT); // ربط قيمة كلمة المرور المشفرة
            $upd->bindValue(2, $email,   SQLITE3_TEXT); // ربط قيمة البريد الإلكتروني
            $upd->execute(); // تنفيذ أمر التحديث
            
            // إرسال استجابة بنجاح العملية وإرجاع الرقم المعرف للمستخدم
            json_response(200, [
                'success' => true,
                'message' => 'تم إعادة تعيين كلمة المرور إلى admin123',
                'user_id' => (int)$exists,
            ]);
        } else {
            // إذا لم يكن الحساب موجوداً: يتم إنشاء حساب مدير نظام جديد كلياً
            $ins = $db->prepare('INSERT INTO users (name, email, password_hash, is_admin) VALUES (?, ?, ?, 1)');
            $ins->bindValue(1, 'مدير النظام', SQLITE3_TEXT); // ربط الاسم الافتراضي
            $ins->bindValue(2, $email,        SQLITE3_TEXT); // ربط البريد الإلكتروني
            $ins->bindValue(3, $newHash,      SQLITE3_TEXT); // ربط الباسوورد المشفر
            $ins->execute(); // تنفيذ أمر الإدخال
            
            // إرسال استجابة بنجاح الإنشاء وإرجاع رقم المعرف الجديد (Last Insert ID)
            json_response(200, [
                'success' => true,
                'message' => 'تم إنشاء حساب المدير الافتراضي.',
                'user_id' => (int)$db->lastInsertRowID(),
            ]);
        }
    }

    // ------------------------------------------------------------
    // مسار: التشخيص والصيانة المؤقت (GET /api/admin/diag)
    // ------------------------------------------------------------
    if ($path === '/api/admin/diag' && $method === 'GET') {
        // حساب إجمالي عدد المديرين في النظام
        $adminCount = (int)$db->querySingle('SELECT COUNT(*) FROM users WHERE is_admin = 1');
        // حساب إجمالي عدد كل المستخدمين في النظام
        $userCount  = (int)$db->querySingle('SELECT COUNT(*) FROM users');
        
        // جلب قائمة بكافة المستخدمين مرتبين حسب معرفاتهم الرقمية
        $res = $db->query('SELECT id, name, email, phone, is_admin FROM users ORDER BY id');
        $users = [];
        
        // حلقة تكرارية لتحويل الصفوف الناتجة من قاعدة البيانات إلى مصفوفة PHP مرتبة
        while ($r = $res->fetchArray(SQLITE3_ASSOC)) {
            $users[] = [
                'id' => (int)$r['id'], // تحويل المعرف النصي إلى رقم صحيح
                'name' => $r['name'],
                'email' => $r['email'],
                'phone' => $r['phone'],
                'is_admin' => (int)$r['is_admin'] === 1, // تحويل القيمة (0 أو 1) إلى قيمة منطقية (True/False)
            ];
        }
        
        // إرجاع كافة البيانات التشخيصية بصيغة JSON لسهولة الفحص والتأكد من البيانات
        json_response(200, [
            'success' => true,
            'admin_count' => $adminCount,
            'user_count'  => $userCount,
            'users'       => $users,
            'db_file'     => $dbFile, // إرجاع مسار ملف قاعدة البيانات المستخدمة
        ]);
    }

    // ------------------------------------------------------------
    // مسار: ترقية المستخدم الأول لمدير (POST /api/admin/bootstrap)
    // ------------------------------------------------------------
    if ($path === '/api/admin/bootstrap' && $method === 'POST') {
        $caller = require_auth($db); // التحقق من أن المستخدم قام بتسجيل الدخول أولاً وجلب بياناته
        $adminCount = (int)$db->querySingle('SELECT COUNT(*) FROM users WHERE is_admin = 1'); // فحص وجود أي مديرين

        $body = read_json_body(); // قراءة البيانات المرسلة في جسم الطلب (JSON)
        $secret = isset($body['secret']) ? (string)$body['secret'] : ''; // جلب الكود السري إن وجد
        $bootstrapSecret = ''; // الكود السري المعتمد في السيرفر لطوارئ الترقية

        // السماح بالترقية فقط في حالتين: إما لا يوجد أدمن مطلقاً، أو تم إرسال الكود السري الصحيح للطوارئ
        $allowed = ($adminCount === 0) ||
                   ($bootstrapSecret !== '' && hash_equals($bootstrapSecret, $secret)); // مقارنة آمنة تمنع ثغرات التوقيت الزمني

        if (!$allowed) {
            // إذا لم يتحقق الشرط، يتم حظر الطلب وإرجاع خطأ 403 (غير مسموح)
            json_response(403, [
                'success' => false,
                'error'   => 'يوجد مدير بالفعل. استخدم حساب المدير الحالي أو تواصل مع المسؤول.',
            ]);
        }

        // تحديث صلاحية المستخدم الحالي الذي قام بالطلب ليصبح مديراً (is_admin = 1)
        $upd = $db->prepare('UPDATE users SET is_admin = 1 WHERE id = ?');
        $upd->bindValue(1, $caller['id'], SQLITE3_INTEGER);
        $upd->execute();

        // إرجاع بيانات المستخدم بعد الترقية وإبلاغه بإعادة تسجيل الدخول لتحديث الـ Token/Session
        json_response(200, [
            'success' => true,
            'message' => 'تمت ترقية الحساب لمدير. سجّل دخول مرة أخرى لتفعيل التغييرات.',
            'user' => [
                'id' => $caller['id'], 'name' => $caller['name'],
                'email' => $caller['email'], 'phone' => $caller['phone'],
                'is_admin' => true,
            ],
        ]);
    }

    // ------------------------------------------------------------
    // مسار: جلب إحصائيات لوحة التحكم (GET /api/admin/stats)
    // ------------------------------------------------------------
    if ($path === '/api/admin/stats' && $method === 'GET') {
        require_admin($db); // التحقق الإلزامي من أن المستخدم الحالي لديه صلاحية أدمن

        // استعلام متقدم لجلب إجمالي الحجوزات وتصنيف أعدادها حسب حالتها الحالية في استعلام واحد لتوفير الأداء
        $row = $db->querySingle(
            'SELECT
               COUNT(*) AS total,
               SUM(CASE WHEN status = "pending"   THEN 1 ELSE 0 END) AS pending,
               SUM(CASE WHEN status = "confirmed" THEN 1 ELSE 0 END) AS confirmed,
               SUM(CASE WHEN status = "completed" THEN 1 ELSE 0 END) AS completed,
               SUM(CASE WHEN status = "cancelled" THEN 1 ELSE 0 END) AS cancelled
             FROM bookings',
            true // تمرير القيمة true ليعيد النتيجة كمصفوفة مفتاحية (Associative Array)
        ) ?: [];

        $doctorsCount = (int)$db->querySingle('SELECT COUNT(*) FROM doctors'); // حساب عدد الأطباء المسجلين
        $usersCount   = (int)$db->querySingle('SELECT COUNT(*) FROM users'); // حساب عدد المستخدمين المسجلين
        $adminsCount  = (int)$db->querySingle('SELECT COUNT(*) FROM users WHERE is_admin = 1'); // حساب عدد المديرين الحاليين
        $today        = $db->querySingle("SELECT COUNT(*) FROM bookings WHERE date = date('now')"); // حساب عدد حجوزات اليوم الحالي

        // استعلام معقد لربط الأطباء بالحجوزات واستخراج توزيع التخصصات الطبية، عدد الأطباء بها، وإجمالي الحجوزات النشطة والكلية
        $specRes = $db->query(
            'SELECT d.specialty,
                    COUNT(DISTINCT d.id) AS doctors,
                    COUNT(b.id) AS total_bookings,
                    SUM(CASE WHEN b.status NOT IN ("cancelled","completed") THEN 1 ELSE 0 END) AS active_bookings
             FROM doctors d
             LEFT JOIN bookings b ON b.doctor_id = d.id
             GROUP BY d.specialty
             ORDER BY doctors DESC, total_bookings DESC' // ترتيب التخصصات حسب الأكثر أطباء ثم الأكثر حجوزات
        );
        
        $specialties = [];
        while ($r = $specRes->fetchArray(SQLITE3_ASSOC)) {
            $specialties[] = [
                'specialty'       => $r['specialty'],
                'doctors'         => (int)$r['doctors'],
                'total_bookings'  => (int)$r['total_bookings'],
                'active_bookings' => (int)($r['active_bookings'] ?? 0), // الحجوزات التي لم تلغى ولم تكتمل بعد
            ];
        }

        // إرسال جميع البيانات المجمعة لتعرض في واجهة لوحة التحكم الرئيسية (Charts & Cards)
        json_response(200, [
            'success' => true,
            'stats' => [
                'total_bookings'     => (int)($row['total']     ?? 0),
                'pending_bookings'   => (int)($row['pending']   ?? 0),
                'confirmed_bookings' => (int)($row['confirmed'] ?? 0),
                'completed_bookings' => (int)($row['completed'] ?? 0),
                'cancelled_bookings' => (int)($row['cancelled'] ?? 0),
                'today_bookings'     => (int)$today,
                'doctors_count'      => $doctorsCount,
                'users_count'        => $usersCount,
                'admins_count'       => $adminsCount,
            ],
            'specialties' => $specialties,
        ]);
    }

    // ------------------------------------------------------------
    // مسار: جلب وإدارة قائمة الأطباء (GET /api/admin/doctors)
    // ------------------------------------------------------------
    if ($path === '/api/admin/doctors' && $method === 'GET') {
        require_admin($db); // حماية المسار: أدمن فقط
        
        // استعلام لجلب الأطباء مع حساب عدد الحجوزات الإجمالي والنشط لكل طبيب مع جلب التقييمات
        $res = $db->query(
            'SELECT d.id, d.name, d.specialty, d.phone, d.rating,
                    COUNT(b.id) AS bookings_count,
                    SUM(CASE WHEN b.status NOT IN ("cancelled","completed") THEN 1 ELSE 0 END) AS active_count
             FROM doctors d
             LEFT JOIN bookings b ON b.doctor_id = d.id
             GROUP BY d.id
             ORDER BY bookings_count DESC, d.rating DESC' // الترتيب بالأطباء الأكثر طلباً ثم الأعلى تقييماً
        );
        
        $rows = [];
        while ($r = $res->fetchArray(SQLITE3_ASSOC)) {
            $rows[] = [
                'id'             => (int)$r['id'],
                'name'           => $r['name'],
                'specialty'      => $r['specialty'],
                'phone'          => $r['phone'],
                'rating'         => (float)$r['rating'], // تحويل التقييم لرقم عشري (Float)
                'bookings_count' => (int)$r['bookings_count'],
                'active_count'   => (int)($r['active_count'] ?? 0),
            ];
        }
        json_response(200, ['success' => true, 'doctors' => $rows]);
    }

    // ------------------------------------------------------------
    // مسار: استعراض كافة الحجوزات مع الفلترة والبحث (GET /api/admin/bookings)
    // ------------------------------------------------------------
    if ($path === '/api/admin/bookings' && $method === 'GET') {
        require_admin($db); // حماية المسار

        $where  = []; // مصفوفة لتجميع شروط الفلترة الديناميكية (WHERE clause)
        $params = []; // مصفوفة لتجميع القيم المرتبطة بالشروط لمنع الـ SQL Injection
        
        // الفلترة حسب طبيب معين إذا تم إرسال المعرف في الرابط
        if (isset($_GET['doctor_id']) && is_numeric($_GET['doctor_id'])) {
            $where[] = 'b.doctor_id = ?';
            $params[] = [(int)$_GET['doctor_id'], SQLITE3_INTEGER];
        }
        // الفلترة حسب حالة الحجز (مثال: مؤكد، معلق)
        if (!empty($_GET['status'])) {
            $where[] = 'b.status = ?';
            $params[] = [clean_string($_GET['status'], 30), SQLITE3_TEXT];
        }
        // الفلترة حسب نوع الخدمة (كشف عيادة، استشارة منزلية)
        if (!empty($_GET['service_type'])) {
            $where[] = 'b.service_type = ?';
            $params[] = [clean_string($_GET['service_type'], 20), SQLITE3_TEXT];
        }
        // البحث النصي (Query Search) باسم المريض أو رقم هاتفه باستخدام علامة %LIKE%
        if (!empty($_GET['q'])) {
            $where[] = '(b.patient_name LIKE ? OR b.phone LIKE ?)';
            $q = '%' . clean_string($_GET['q'], 100) . '%';
            $params[] = [$q, SQLITE3_TEXT];
            $params[] = [$q, SQLITE3_TEXT];
        }

        // بناء نص استعلام الـ SQL مع ربط جداول الحجوزات، الأطباء، العيادات، والمستخدمين لجلب صورة كاملة عن كل حجز
        $sql = 'SELECT b.id, b.doctor_id, b.user_id, b.patient_name, b.phone, b.date,
                       b.payment_method, b.notes, b.status, b.service_type, b.location_id,
                       b.created_at,
                       d.name AS doctor_name, d.specialty,
                       dl.clinic_name AS location_name, dl.address AS location_address,
                       u.name AS user_name, u.email AS user_email
                FROM bookings b
                LEFT JOIN doctors d            ON d.id  = b.doctor_id
                LEFT JOIN doctor_locations dl  ON dl.id = b.location_id
                LEFT JOIN users u              ON u.id  = b.user_id';
        
        // دمج الشروط المجمعة (إن وجدت) وربطها بكلمة AND في الاستعلام
        if (!empty($where)) $sql .= ' WHERE ' . implode(' AND ', $where);
        $sql .= ' ORDER BY b.created_at DESC LIMIT 500'; // جلب أحدث 500 حجز فقط لحماية السيرفر من البطء

        $stmt = $db->prepare($sql);
        // حلقة لربط كافة القيم بالاستعلام المجهز (Prepared Statement) بشكل ديناميكي وآمن
        foreach ($params as $i => $p) $stmt->bindValue($i + 1, $p[0], $p[1]);
        $res = $stmt->execute();

        $rows = [];
        while ($r = $res->fetchArray(SQLITE3_ASSOC)) $rows[] = $r; // تجميع كافة نتائج الحجوزات الفلترية
        json_response(200, ['success' => true, 'bookings' => $rows]);
    }

    // ------------------------------------------------------------
    // مسار: تعديل حالة حجز معين (PATCH /api/admin/bookings/{id})
    // ------------------------------------------------------------
    if ($method === 'PATCH' && preg_match('#^/api/admin/bookings/(\d+)$#', $path, $m)) {
        require_admin($db); // حماية المسار
        $bookingId = (int)$m[1]; // استخراج معرف الحجز الرقمي المستهدف من الرابط عبر التعبير النمطي (RegEx)
        $body = read_json_body(); // قراءة محتوى الـ JSON المرسل
        $status = clean_string($body['status'] ?? null, 30); // تنظيف نص الحالة القادمة
        
        // الحالات المسموح بالتحويل إليها فقط لحماية منطق العمل بالنظام
        $allowed = ['pending', 'confirmed', 'completed', 'cancelled'];
        if ($status === null || !in_array($status, $allowed, true)) {
            json_response(400, ['success' => false, 'error' => 'حالة غير صالحة']); // إرجاع خطأ 400 في حال كانت الحالة غير معرفة
        }

        // تحديث حالة الحجز في الجدول بناءً على المعرف الممرر
        $stmt = $db->prepare('UPDATE bookings SET status = ? WHERE id = ?');
        $stmt->bindValue(1, $status,    SQLITE3_TEXT);
        $stmt->bindValue(2, $bookingId, SQLITE3_INTEGER);
        $stmt->execute();
        
        // التحقق مما إذا تم تعديل أي صف بالفعل، لو رجع 0 يعني أن المعرف غير موجود بالـ DB
        if ($db->changes() === 0) {
            json_response(404, ['success' => false, 'error' => 'الحجز غير موجود']);
        }
        json_response(200, ['success' => true, 'id' => $bookingId, 'status' => $status]);
    }

    // ------------------------------------------------------------
    // مسار: استعراض وفلترة قائمة المستخدمين (GET /api/admin/users)
    // ------------------------------------------------------------
    if ($path === '/api/admin/users' && $method === 'GET') {
        require_admin($db); // حماية المسار

        $q    = isset($_GET['q'])    ? trim((string)$_GET['q'])    : ''; // جلب قيمة نص البحث
        $role = isset($_GET['role']) ? trim((string)$_GET['role']) : ''; // جلب نوع الفلترة بالصلاحيات (أدمن أم مستخدم عادي)

        $where  = [];
        $params = [];
        // تضمين البحث في ثلاثة حقول (الاسم، الإيميل، الهاتف)
        if ($q !== '') {
            $where[] = '(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)';
            $like = '%' . $q . '%';
            $params[] = [$like, SQLITE3_TEXT];
            $params[] = [$like, SQLITE3_TEXT];
            $params[] = [$like, SQLITE3_TEXT];
        }
        // فلترة بناءً على حقل الـ Boolean (is_admin)
        if ($role === 'admin') { $where[] = 'u.is_admin = 1'; }
        elseif ($role === 'user') { $where[] = 'u.is_admin = 0'; }

        // استعلام لجلب المستخدمين مع حساب عدد حجوزات كل مستخدم وتاريخ آخر حجز قام به
        $sql = 'SELECT u.id, u.name, u.email, u.phone, u.is_admin, u.created_at,
                       COUNT(b.id) AS bookings_count,
                       MAX(b.created_at) AS last_booking_at
                FROM users u
                LEFT JOIN bookings b ON b.user_id = u.id';
        if ($where) $sql .= ' WHERE ' . implode(' AND ', $where);
        $sql .= ' GROUP BY u.id ORDER BY u.is_admin DESC, u.created_at DESC'; // ترتيب بعرض المديرين أولاً ثم الأحدث تسجيلاً

        $stmt = $db->prepare($sql);
        foreach ($params as $i => $p) $stmt->bindValue($i + 1, $p[0], $p[1]);
        $res = $stmt->execute();
        $rows = [];
        
        while ($r = $res->fetchArray(SQLITE3_ASSOC)) {
            $rows[] = [
                'id'              => (int)$r['id'],
                'name'            => $r['name'],
                'email'           => $r['email'],
                'phone'           => $r['phone'],
                'is_admin'        => ((int)$r['is_admin']) === 1,
                'created_at'      => $r['created_at'],
                'bookings_count'  => (int)$r['bookings_count'],
                'last_booking_at' => $r['last_booking_at'],
            ];
        }
        json_response(200, ['success' => true, 'users' => $rows]);
    }

    // ------------------------------------------------------------
    // مسار: جلب تفاصيل مستخدم محدد وحجوزاته (GET /api/admin/users/{id})
    // ------------------------------------------------------------
    if ($method === 'GET' && preg_match('#^/api/admin/users/(\d+)$#', $path, $m)) {
        require_admin($db); // حماية المسار
        $userId = (int)$m[1]; // استخراج معرف المستخدم المستهدف من الرابط

        // جلب البيانات الشخصية للمستخدم الأساسي
        $stmt = $db->prepare(
            'SELECT id, name, email, phone, is_admin, created_at
             FROM users WHERE id = ? LIMIT 1'
        );
        $stmt->bindValue(1, $userId, SQLITE3_INTEGER);
        $u = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
        if (!$u) json_response(404, ['success' => false, 'error' => 'المستخدم غير موجود']); // خطأ في حال عدم وجود المستخدم

        // استعلام إضافي لجلب سجل الحجوزات الكامل الخاص بهذا المستخدم بالتحديد (بحد أقصى أحدث 100 حجز)
        $bstmt = $db->prepare(
            'SELECT b.id, b.patient_name, b.phone, b.date, b.status,
                    b.service_type, b.payment_method, b.created_at,
                    d.name AS doctor_name, d.specialty
             FROM bookings b
             LEFT JOIN doctors d ON d.id = b.doctor_id
             WHERE b.user_id = ?
             ORDER BY b.created_at DESC
             LIMIT 100'
        );
        $bstmt->bindValue(1, $userId, SQLITE3_INTEGER);
        $bres = $bstmt->execute();
        $bookings = [];
        
        while ($r = $bres->fetchArray(SQLITE3_ASSOC)) {
            $bookings[] = [
                'id'             => (int)$r['id'],
                'patient_name'   => $r['patient_name'],
                'phone'          => $r['phone'],
                'date'           => $r['date'],
                'status'         => $r['status'],
                'service_type'   => $r['service_type'],
                'payment_method' => $r['payment_method'],
                'created_at'     => $r['created_at'],
                'doctor_name'    => $r['doctor_name'],
                'specialty'      => $r['specialty'],
            ];
        }

        // دمج بيانات المستخدم الشخصية مع مصفوفة تاريخ حجوزاته وإرسالها كاملة
        json_response(200, [
            'success' => true,
            'user' => [
                'id'         => (int)$u['id'],
                'name'       => $u['name'],
                'email'      => $u['email'],
                'phone'      => $u['phone'],
                'is_admin'   => ((int)$u['is_admin']) === 1,
                'created_at' => $u['created_at'],
            ],
            'bookings' => $bookings,
        ]);
    }

    // ------------------------------------------------------------
    // مسار: تعديل صلاحيات المستخدم/المدير (PATCH /api/admin/users/{id})
    // ------------------------------------------------------------
    if ($method === 'PATCH' && preg_match('#^/api/admin/users/(\d+)$#', $path, $m)) {
        $caller = require_admin($db); // التأكد من هوية القائم بالطلب (الأدمن الحالي) وحفظ بياناته لحماية العمليات اللاحقة
        $userId = (int)$m[1]; // معرف المستخدم المراد ترقيته أو سحب صلاحياته
        $body = read_json_body();

        // التأكد من أن الحقل المطلوب متوفر في جسم الطلب
        if (!array_key_exists('is_admin', $body)) {
            json_response(400, ['success' => false, 'error' => 'is_admin مطلوب']);
        }
        $newFlag = $body['is_admin'] ? 1 : 0; // تحويل الـ Boolean إلى (1 أو 0) ليتوافق مع SQLite

        // جلب البيانات الحالية للمستخدم المستهدف للتأكد من وجوده وفحص حالته الحالية
        $stmt = $db->prepare('SELECT id, name, is_admin FROM users WHERE id = ? LIMIT 1');
        $stmt->bindValue(1, $userId, SQLITE3_INTEGER);
        $target = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
        if (!$target) json_response(404, ['success' => false, 'error' => 'المستخدم غير موجود']);

        // [صمام أمان 1]: منع الأدمن من سحب الصلاحيات الإدارية عن نفسه بالخطأ لمنع إغلاق لوحة التحكم عليه
        if ($newFlag === 0 && (int)$target['id'] === (int)$caller['id']) {
            json_response(400, [
                'success' => false,
                'error'   => 'لا يمكنك إلغاء صلاحياتك الإدارية عن نفسك. اطلب من مدير آخر القيام بذلك.',
            ]);
        }

        // [صمام أمان 2]: إذا كان الإجراء هو إلغاء صلاحية أدمن، نتأكد أولاً أنه ليس الأدمن "الأخير الوحيد" في النظام
        if ($newFlag === 0 && (int)$target['is_admin'] === 1) {
            $adminCount = (int)$db->querySingle('SELECT COUNT(*) FROM users WHERE is_admin = 1');
            if ($adminCount <= 1) {
                json_response(400, [
                    'success' => false,
                    'error'   => 'لا يمكن إلغاء صلاحيات آخر مدير في النظام.',
                ]);
            }
        }

        // بعد تخطي صمامات الأمان، يتم تحديث حقل الصلاحية في قاعدة البيانات بنجاح
        $upd = $db->prepare('UPDATE users SET is_admin = ? WHERE id = ?');
        $upd->bindValue(1, $newFlag, SQLITE3_INTEGER);
        $upd->bindValue(2, $userId, SQLITE3_INTEGER);
        $upd->execute();

        json_response(200, [
            'success'  => true,
            'user'     => [
                'id'       => (int)$target['id'],
                'name'     => $target['name'],
                'is_admin' => $newFlag === 1,
            ],
            'message'  => $newFlag === 1 ? 'تمت ترقية المستخدم لمدير' : 'تم إلغاء صلاحيات الإدارة',
        ]);
    }

    // ------------------------------------------------------------
    // مسار: الحذف النهائي للحجز (DELETE /api/admin/bookings/{id})
    // ------------------------------------------------------------
    if ($method === 'DELETE' && preg_match('#^/api/admin/bookings/(\d+)$#', $path, $m)) {
        require_admin($db); // حماية المسار
        $bookingId = (int)$m[1]; // استخراج معرف الحجز

        // تنفيذ استعلام المسح الحقيقي (Hard Delete) من جدول الحجوزات بناءً على المعرف الممرر
        $stmt = $db->prepare('DELETE FROM bookings WHERE id = ?');
        $stmt->bindValue(1, $bookingId, SQLITE3_INTEGER);
        $stmt->execute();
        
        // التحقق من تأثر قاعدة البيانات (إذا رجع 0 يعني لم يتم مسح شيء لأن المعرف خاطئ)
        if ($db->changes() === 0) {
            json_response(404, ['success' => false, 'error' => 'الحجز غير موجود']);
        }
        // إرجاع استجابة بنجاح الحذف مع تمرير رقم الحجز المحذوف ليتم إزالته من واجهة المستخدم (UI)
        json_response(200, ['success' => true, 'deleted' => $bookingId]);
    }