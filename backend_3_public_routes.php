<?php
// ============================================================
// الجزء الثالث من الـ Backend: المسارات العامة (Public & User Routes)
// ============================================================

    // ---------- نظام التوجيه وتحديد المسارات (Routing) ----------
    
    // استخراج المسار (Path) فقط من الـ URL وتنظيفه من أي معامِلات إضافية (مثل: ?id=5)
    $path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '';
    // تنظيف المسار وإزالة اسم ملف السيرفر الأساسي (backend.php) إذا ظهر في الـ URL لتوحيد شكل الروت
    $path = preg_replace('#^.*backend\.php#', '', $path);
    // جلب نوع الـ HTTP Request المستخدم في الطلب (GET, POST, PATCH, DELETE)
    $method = $_SERVER['REQUEST_METHOD'];

    // ----- أولاً: مسارات القراءة العامة (Public Reads) -----
    
    // روت جلب الأطباء: متاح للجميع، يعيد أعلى 50 طبيباً في التقييم
    if ($path === '/api/doctors' && $method === 'GET') {
        $result = $db->query('SELECT * FROM doctors ORDER BY rating DESC LIMIT 50');
        $rows = [];
        while ($row = $result->fetchArray(SQLITE3_ASSOC)) $rows[] = $row;
        json_response(200, ['success' => true, 'doctors' => $rows]);
    }

    // روت جلب المستشفيات والعيادات الكبرى: متاح للجميع، يعيد أعلى 50 منشأة تقييماً
    if ($path === '/api/clinics' && $method === 'GET') {
        $result = $db->query('SELECT * FROM clinics ORDER BY rating DESC LIMIT 50');
        $rows = [];
        while ($row = $result->fetchArray(SQLITE3_ASSOC)) $rows[] = $row;
        json_response(200, ['success' => true, 'clinics' => $rows]);
    }

    // ----- ثانياً: نظام التسجيل والدخول (Authentication) -----
    
    // روت تسجيل حساب جديد (Register)
    if ($path === '/api/register' && $method === 'POST') {
        $input = read_json_body(); // قراءة البيانات القادمة بصيغة JSON
        // تنظيف وفلترة المدخلات لمنع ثغرات الـ XSS وحقن النصوص
        $name     = clean_string($input['name']   ?? null, 200);
        $email    = clean_string($input['email'] ?? null, 200, true);
        $phone    = clean_string($input['phone'] ?? null, 20,  true);
        $password = isset($input['password']) && is_string($input['password']) ? $input['password'] : '';

        // التحقق من صحة البيانات (Data Validation)
        if ($name === null) json_response(400, ['success' => false, 'error' => 'Invalid name']);
        if ($email === '' && $phone === '') {
            json_response(400, ['success' => false, 'error' => 'Email or phone required']);
        }
        if ($email !== '' && !valid_email($email)) json_response(400, ['success' => false, 'error' => 'Invalid email']);
        if ($phone !== '' && !valid_phone($phone)) json_response(400, ['success' => false, 'error' => 'Invalid phone']);
        if (strlen($password) < 8 || strlen($password) > 128) {
            json_response(400, ['success' => false, 'error' => 'Password must be 8-128 characters']);
        }

        // التأكد من أن البريد الإلكتروني غير مسجل مسبقاً في النظام لحظر التكرار
        if ($email !== '') {
            $chk = $db->prepare('SELECT 1 FROM users WHERE email = ? LIMIT 1');
            $chk->bindValue(1, $email, SQLITE3_TEXT);
            if ($chk->execute()->fetchArray()) {
                json_response(409, ['success' => false, 'error' => 'Email already registered']);
            }
        }
        // التأكد من أن رقم الهاتف غير مسجل مسبقاً
        if ($phone !== '') {
            $chk = $db->prepare('SELECT 1 FROM users WHERE phone = ? LIMIT 1');
            $chk->bindValue(1, $phone, SQLITE3_TEXT);
            if ($chk->execute()->fetchArray()) {
                json_response(409, ['success' => false, 'error' => 'Phone already registered']);
            }
        }

        // تشفير كلمة المرور بـ Hash آمن للغاية قبل حفظها (لا يتم حفظ الباسوورد صريحاً أبداً)
        $hash = password_hash($password, PASSWORD_DEFAULT);
        if ($hash === false) json_response(500, ['success' => false, 'error' => 'Internal server error']);

        // إدخال المستخدم الجديد في قاعدة البيانات
        $stmt = $db->prepare('INSERT INTO users (name, email, phone, password_hash) VALUES (?, ?, ?, ?)');
        $stmt->bindValue(1, $name, SQLITE3_TEXT);
        $stmt->bindValue(2, $email !== '' ? $email : null, $email !== '' ? SQLITE3_TEXT : SQLITE3_NULL);
        $stmt->bindValue(3, $phone !== '' ? $phone : null, $phone !== '' ? SQLITE3_TEXT : SQLITE3_NULL);
        $stmt->bindValue(4, $hash, SQLITE3_TEXT);
        $stmt->execute();
        $userId = (int) $db->lastInsertRowID(); // جلب الـ ID الخاص بالمستخدم الجديد

        // إصدار توكن جلسة (Bearer Token) للمستخدم مباشرة لتسجيل دخوله تلقائياً بعد التسجيل
        $session = issue_session($db, $userId);
        json_response(201, [
            'success'    => true,
            'token'      => $session['token'],
            'expires_at' => $session['expires_at'],
            'user' => [
                'id'       => $userId,
                'name'     => $name,
                'email'    => $email !== '' ? $email : null,
                'phone'    => $phone !== '' ? $phone : null,
                'is_admin' => false,
            ],
        ]);
    }

    // روت تسجيل الدخول (Login) مع نظام حماية ذكي ضد التخمين (Rate Limiting)
    if ($path === '/api/login' && $method === 'POST') {
        $ip = client_ip(); // تحديد الـ IP الخاص بصاحب الطلب
        // فحص إذا كان هذا الـ IP متجاوزاً للحد المسموح من المحاولات الفاشلة ليتم حظره مؤقتاً
        if (login_is_throttled($db, $ip)) {
            json_response(429, ['success' => false, 'error' => 'Too many attempts. Try again later.']);
        }

        $input      = read_json_body();
        $identifier = clean_string($input['identifier'] ?? null, 200); // قد يكون إيميل أو هاتف
        $password   = isset($input['password']) && is_string($input['password']) ? $input['password'] : '';

        if ($identifier === null || $password === '') {
            record_failed_login($db, $ip); // تسجيل محاولة فاشلة للـ IP الحالي
            json_response(400, ['success' => false, 'error' => 'Invalid credentials']);
        }

        // البحث عن المستخدم باستخدام الإيميل أو رقم الهاتف
        $stmt = $db->prepare('SELECT id, name, email, phone, password_hash, is_admin FROM users WHERE email = ? OR phone = ? LIMIT 1');
        $stmt->bindValue(1, $identifier, SQLITE3_TEXT);
        $stmt->bindValue(2, $identifier, SQLITE3_TEXT);
        $user = $stmt->execute()->fetchArray(SQLITE3_ASSOC);

        // التحقق من صحة كلمة المرور المشفّرة
        if (!$user || !password_verify($password, $user['password_hash'])) {
            record_failed_login($db, $ip); // تسجيل محاولة فاشلة في حال خطأ الباسوورد أو الحساب
            json_response(401, ['success' => false, 'error' => 'Invalid credentials']);
        }

        // تحديث تشفير الباسوورد تلقائياً (Rehash) لو قام السيرفر بتحديث خوارزميات التشفير الأساسية لنسخ أحدث
        if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
            $newHash = password_hash($password, PASSWORD_DEFAULT);
            if ($newHash !== false) {
                $u = $db->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
                $u->bindValue(1, $newHash, SQLITE3_TEXT);
                $u->bindValue(2, $user['id'], SQLITE3_INTEGER);
                $u->execute();
            }
        }

        // مسح سجل المحاولات الفاشلة للـ IP بعد نجاح عملية تسجيل الدخول بنجاح
        clear_failed_logins($db, $ip);
        // توليد وإصدار توكن الجلسة الجديد
        $session = issue_session($db, (int) $user['id']);

        json_response(200, [
            'success'    => true,
            'token'      => $session['token'],
            'expires_at' => $session['expires_at'],
            'user' => [
                'id'       => $user['id'],
                'name'     => $user['name'],
                'email'    => $user['email'],
                'phone'    => $user['phone'],
                'is_admin' => (int)($user['is_admin'] ?? 0) === 1, // تحويل القيمة المنطقية للتأكد من الصلاحية
            ],
        ]);
    }

    // روت تسجيل الخروج (Logout): يتلف الـ Token الحالي من قاعدة البيانات لمنع إعادة استخدامه
    if ($path === '/api/logout' && $method === 'POST') {
        $token = bearer_token(); // استخراج التوكن من الـ Authorization Header
        if ($token !== null) {
            $stmt = $db->prepare('DELETE FROM sessions WHERE token_hash = ?');
            $stmt->bindValue(1, hash_token($token), SQLITE3_TEXT); // مقارنة الهاش لحماية التوكن الأصلي
            $stmt->execute();
        }
        json_response(200, ['success' => true]);
    }

    // روت جلب بيانات المستخدم الحالي (Profile / Me)
    if ($path === '/api/me' && $method === 'GET') {
        $user = current_user($db); // التحقق من التوكن وجلب بيانات صاحبه
        if (!$user) json_response(401, ['success' => false, 'error' => 'Not authenticated']);
        json_response(200, ['success' => true, 'user' => [
            'id'       => $user['id'],
            'name'     => $user['name'],
            'email'    => $user['email'],
            'phone'    => $user['phone'],
            'is_admin' => (int)($user['is_admin'] ?? 0) === 1,
        ]]);
    }

    // ----- ثالثاً: إدارة الحجوزات (Bookings) -----
    
    // روت إنشاء حجز جديد (يتطلب تسجيل دخول إلزامي)
    if ($path === '/api/bookings' && $method === 'POST') {
        $user = require_auth($db); // حماية الروت: يوقف الكود ويرجع 401 لو المستخدم غير مسجل
        $input = read_json_body();

        // فلترة بيانات الحجز بعناية
        $doctorId    = filter_var($input['doctor_id'] ?? null, FILTER_VALIDATE_INT);
        $patientName = clean_string($input['patient_name']   ?? null, 200);
        $phone       = clean_string($input['phone']          ?? null, 20);
        $date        = clean_string($input['date']           ?? null, 10);
        $payment     = clean_string($input['payment_method'] ?? 'cash', 30);
        $notes       = clean_string($input['notes']          ?? null, 500, true);
        $serviceType = clean_string($input['service_type']   ?? 'clinic', 20);
        $locationId  = isset($input['location_id']) ? filter_var($input['location_id'], FILTER_VALIDATE_INT) : null;

        // التحقق من صحة كافة مدخلات الحجز وتوافقها مع الشروط المعيارية للعيادات
        if ($doctorId === false || $doctorId === null || $doctorId <= 0) json_response(400, ['success' => false, 'error' => 'Invalid doctor_id']);
        if ($patientName === null) json_response(400, ['success' => false, 'error' => 'Invalid patient_name']);
        if ($phone === null || !valid_phone($phone)) json_response(400, ['success' => false, 'error' => 'Invalid phone']);
        if ($date === null || !valid_date($date)) json_response(400, ['success' => false, 'error' => 'Invalid date']);
        if ($payment === null || !in_array($payment, ALLOWED_PAYMENT_METHODS, true)) json_response(400, ['success' => false, 'error' => 'Invalid payment_method']);
        if ($notes === null) json_response(400, ['success' => false, 'error' => 'Invalid notes']);
        if (!in_array($serviceType, ['clinic', 'home_visit', 'video', 'chat'], true)) json_response(400, ['success' => false, 'error' => 'Invalid service_type']);
        
        // ربط الفرع/العيادة يكون مدعوماً فقط في حال كان الحجز حضورياً داخل العيادة
        if ($serviceType !== 'clinic') $locationId = null;
        if ($locationId === false) $locationId = null;

        // التأكد من وجود الطبيب الفعلي في قاعدة البيانات أولاً قبل إتمام الحجز
        $check = $db->prepare('SELECT 1 FROM doctors WHERE id = ?');
        $check->bindValue(1, $doctorId, SQLITE3_INTEGER);
        if (!$check->execute()->fetchArray(SQLITE3_ASSOC)) {
            json_response(404, ['success' => false, 'error' => 'Doctor not found']);
        }

        // للخدمات الإضافية (منزلية/فيديو): التأكد من أن هذا الطبيب يفعل هذه الميزة ويقدمها للمرضى حالياً
        if (in_array($serviceType, ['home_visit', 'video', 'chat'], true)) {
            $svc = $db->prepare('SELECT is_available FROM doctor_services WHERE doctor_id = ? AND service_type = ?');
            $svc->bindValue(1, $doctorId,    SQLITE3_INTEGER);
            $svc->bindValue(2, $serviceType, SQLITE3_TEXT);
            $row = $svc->execute()->fetchArray(SQLITE3_ASSOC);
            if (!$row || (int)$row['is_available'] !== 1) {
                json_response(400, ['success' => false, 'error' => 'هذه الخدمة غير متاحة لهذا الطبيب حالياً']);
            }
        }

        // تنفيذ عملية إدخال الحجز بنجاح
        $stmt = $db->prepare(
            'INSERT INTO bookings (user_id, doctor_id, patient_name, phone, date, payment_method, notes, service_type, location_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->bindValue(1, $user['id'],  SQLITE3_INTEGER);
        $stmt->bindValue(2, $doctorId,    SQLITE3_INTEGER);
        $stmt->bindValue(3, $patientName, SQLITE3_TEXT);
        $stmt->bindValue(4, $phone,       SQLITE3_TEXT);
        $stmt->bindValue(5, $date,        SQLITE3_TEXT);
        $stmt->bindValue(6, $payment,     SQLITE3_TEXT);
        $stmt->bindValue(7, $notes,       SQLITE3_TEXT);
        $stmt->bindValue(8, $serviceType, SQLITE3_TEXT);
        $stmt->bindValue(9, $locationId,  $locationId === null ? SQLITE3_NULL : SQLITE3_INTEGER);
        $stmt->execute();
        $newId = (int)$db->lastInsertRowID();

        // عمل دمج (LEFT JOIN) لجلب تفاصيل الطبيب وعنوان العيادة فورا وإعادتها للفرونتد لعرض شاشة تأكيد الحجز مباشرة دون طلب إضافي
        $detail = $db->prepare(
            'SELECT b.id, b.doctor_id, b.patient_name, b.phone, b.date, b.payment_method, b.notes, b.status, b.created_at, b.service_type, b.location_id,
                    d.name AS doctor_name, d.specialty, d.rating AS doctor_rating,
                    dl.clinic_name  AS location_name, dl.address AS location_address, dl.phone AS location_phone
             FROM bookings b
             LEFT JOIN doctors d ON d.id = b.doctor_id
             LEFT JOIN doctor_locations dl ON dl.id = b.location_id
             WHERE b.id = ?'
        );
        $detail->bindValue(1, $newId, SQLITE3_INTEGER);
        $full = $detail->execute()->fetchArray(SQLITE3_ASSOC);

        json_response(201, ['success' => true, 'id' => $newId, 'booking' => $full ?: ['id' => $newId]]);
    }

    // روت جلب قائمة الحجوزات الخاصة بالمستخدم الحالي فقط مرتبة من الأحدث للأقدم
    if ($path === '/api/bookings' && $method === 'GET') {
        $user = require_auth($db);
        $stmt = $db->prepare(
            'SELECT b.id, b.doctor_id, b.patient_name, b.phone, b.date, b.payment_method, b.notes, b.status, b.created_at, b.service_type, b.location_id,
                    d.name AS doctor_name, d.specialty, d.rating AS doctor_rating,
                    dl.clinic_name AS location_name, dl.address AS location_address, dl.phone AS location_phone
             FROM bookings b
             LEFT JOIN doctors d ON d.id = b.doctor_id
             LEFT JOIN doctor_locations dl ON dl.id = b.location_id
             WHERE b.user_id = ?
             ORDER BY b.date DESC, b.created_at DESC'
        );
        $stmt->bindValue(1, $user['id'], SQLITE3_INTEGER);
        $res = $stmt->execute();
        $rows = [];
        while ($row = $res->fetchArray(SQLITE3_ASSOC)) $rows[] = $row;
        json_response(200, ['success' => true, 'bookings' => $rows]);
    }

    // روت إلغاء الحجز بواسطة المستخدم (PATCH /api/bookings/{id})
    if ($method === 'PATCH' && preg_match('#^/api/bookings/(\d+)$#', $path, $m)) {
        $user = require_auth($db);
        $bookingId = (int)$m[1]; // استخراج معرف الحجز الممُمر في الرابط عبر الـ Regular Expression
        $body = read_json_body();
        $newStatus = clean_string($body['status'] ?? null, 20);

        if ($newStatus !== 'cancelled') {
            json_response(400, ['success' => false, 'error' => 'يمكن للمستخدم إلغاء الحجز فقط']);
        }

        // التأكد من ملكية الحجز وحالته الحالية قبل الإلغاء
        $chk = $db->prepare('SELECT user_id, status FROM bookings WHERE id = ?');
        $chk->bindValue(1, $bookingId, SQLITE3_INTEGER);
        $row = $chk->execute()->fetchArray(SQLITE3_ASSOC);
        
        if (!$row) json_response(404, ['success' => false, 'error' => 'الحجز غير موجود']);
        if ((int)$row['user_id'] !== (int)$user['id']) json_response(403, ['success' => false, 'error' => 'لا يمكنك تعديل حجز شخص آخر']);
        if (in_array($row['status'], ['completed', 'cancelled'], true)) {
            json_response(400, ['success' => false, 'error' => 'لا يمكن إلغاء حجز مكتمل أو ملغي بالفعل']);
        }

        // تحديث حالة الحجز إلى ملغي
        $upd = $db->prepare('UPDATE bookings SET status = ? WHERE id = ?');
        $upd->bindValue(1, 'cancelled', SQLITE3_TEXT);
        $upd->bindValue(2, $bookingId, SQLITE3_INTEGER);
        $upd->execute();

        json_response(200, ['success' => true, 'id' => $bookingId, 'status' => 'cancelled']);
    }

    // ----- رابعاً: الملف الكامل للطبيب والتقييمات -----
    
    // روت جلب الملف التعريفي الكامل للطبيب (GET /api/doctors/{id}) يدمج الفروع والمواعيد والخدمات الفرعية
    if ($method === 'GET' && preg_match('#^/api/doctors/(\d+)$#', $path, $m)) {
        $doctorId = (int)$m[1];

        // 1. جلب البيانات الأساسية للطبيب
        $stmt = $db->prepare('SELECT * FROM doctors WHERE id = ?');
        $stmt->bindValue(1, $doctorId, SQLITE3_INTEGER);
        $doctor = $stmt->execute()->fetchArray(SQLITE3_ASSOC) ?: null;

        // 2. جلب أحدث 100 مراجعة وتقييم كتبها المرضى لهذا الطبيب
        $stmt = $db->prepare(
            'SELECT r.id, r.rating, r.comment, r.created_at, u.name AS user_name
             FROM doctor_reviews r
             JOIN users u ON u.id = r.user_id
             WHERE r.doctor_id = ?
             ORDER BY r.created_at DESC LIMIT 100'
        );
        $stmt->bindValue(1, $doctorId, SQLITE3_INTEGER);
        $res = $stmt->execute();
        $reviews = [];
        while ($row = $res->fetchArray(SQLITE3_ASSOC)) $reviews[] = $row;

        // 3. حساب المتوسط الحسابي الدقيق لتقييمات الطبيب وعدد المقيمين الكلي
        $stmt = $db->prepare('SELECT COUNT(*) AS count, COALESCE(AVG(rating), 0) AS avg_rating FROM doctor_reviews WHERE doctor_id = ?');
        $stmt->bindValue(1, $doctorId, SQLITE3_INTEGER);
        $agg = $stmt->execute()->fetchArray(SQLITE3_ASSOC);

        // 4. جلب كافة الفروع والعيادات التي يعمل بها الطبيب (Locations)
        $stmt = $db->prepare('SELECT id, clinic_name, address, phone, price, lat, lng FROM doctor_locations WHERE doctor_id = ? ORDER BY sort_order ASC, id ASC');
        $stmt->bindValue(1, $doctorId, SQLITE3_INTEGER);
        $res = $stmt->execute();
        $locations = [];
        $locationIds = [];
        while ($row = $res->fetchArray(SQLITE3_ASSOC)) {
            $row['schedule'] = []; // مصفوفة فارغة سيتم تعبئتها بمواعيد الفرع أدناه
            $locations[] = $row;
            $locationIds[] = (int)$row['id'];
        }

        // 5. جلب مواعيد العمل لكافة الفروع دفعة واحدة عبر استعلام مجمع (Optimization) ثم توزيعها برمجياً
        if (!empty($locationIds)) {
            $placeholders = implode(',', array_fill(0, count($locationIds), '?'));
            $stmt = $db->prepare("SELECT location_id, day_of_week, start_time, end_time FROM location_schedules WHERE location_id IN ($placeholders) ORDER BY day_of_week ASC, start_time ASC");
            foreach ($locationIds as $i => $lid) {
                $stmt->bindValue($i + 1, $lid, SQLITE3_INTEGER);
            }
            $res = $stmt->execute();
            $byLoc = [];
            while ($row = $res->fetchArray(SQLITE3_ASSOC)) {
                $byLoc[(int)$row['location_id']][] = [
                    'day_of_week' => (int)$row['day_of_week'],
                    'start_time'  => $row['start_time'],
                    'end_time'    => $row['end_time'],
                ];
            }
            // ربط كل جدول مواعيد بالفرع الخاص به
            foreach ($locations as &$loc) {
                $loc['schedule'] = $byLoc[(int)$loc['id']] ?? [];
            }
            unset($loc);
        }

        // 6. جلب الخدمات الإضافية المتاحة (كشف منزلي، استشارة فيديو، شات تواصل)
        $stmt = $db->prepare('SELECT service_type, is_available, price, available_hours, description FROM doctor_services WHERE doctor_id = ?');
        $stmt->bindValue(1, $doctorId, SQLITE3_INTEGER);
        $res = $stmt->execute();
        $services = [];
        while ($row = $res->fetchArray(SQLITE3_ASSOC)) {
            $services[$row['service_type']] = [
                'service_type'    => $row['service_type'],
                'is_available'    => (bool)$row['is_available'],
                'price'           => $row['price'] !== null ? (int)$row['price'] : null,
                'available_hours' => $row['available_hours'],
                'description'     => $row['description'],
            ];
        }

        // تصدير كائن البيانات الضخم والكامل متوافقاً 100% مع احتياجات واجهة العرض
        json_response(200, [
            'success'      => true,
            'doctor'       => $doctor,
            'reviews'      => $reviews,
            'avg_rating'   => round((float)$agg['avg_rating'], 2),
            'review_count' => (int)$agg['count'],
            'locations'    => $locations,
            'services'     => $services,
        ]);
    }

    // روت مستقل لجلب مراجعات طبيب معين فقط
    if ($method === 'GET' && preg_match('#^/api/doctors/(\d+)/reviews$#', $path, $m)) {
        $doctorId = (int)$m[1];
        $stmt = $db->prepare(
            'SELECT r.id, r.rating, r.comment, r.created_at, u.name AS user_name
             FROM doctor_reviews r JOIN users u ON u.id = r.user_id
             WHERE r.doctor_id = ? ORDER BY r.created_at DESC LIMIT 100'
        );
        $stmt->bindValue(1, $doctorId, SQLITE3_INTEGER);
        $res = $stmt->execute();
        $reviews = [];
        while ($row = $res->fetchArray(SQLITE3_ASSOC)) $reviews[] = $row;
        json_response(200, ['success' => true, 'reviews' => $reviews]);
    }

    // روت إرسال تقييم وتعليق جديد للطبيب (يتطلب تسجيل دخول) باستخدام الـ Upsert الذكي لـ SQLite
    if ($method === 'POST' && preg_match('#^/api/doctors/(\d+)/reviews$#', $path, $m)) {
        $user = require_auth($db);
        $doctorId = (int)$m[1];
        $body = read_json_body();

        $rating = isset($body['rating']) ? (int)$body['rating'] : 0;
        if ($rating < 1 || $rating > 5) json_response(400, ['success' => false, 'error' => 'التقييم يجب أن يكون بين 1 و 5']);
        $comment = clean_string($body['comment'] ?? null, 1000, true);

        // آلية الـ Upsert: إذا كان المريض يمتلك تقييماً سابقاً لهذا الطبيب، يتم تعديله وتحديثه فوراً بدل توليد صف مكرر
        $stmt = $db->prepare(
            'INSERT INTO doctor_reviews (doctor_id, user_id, rating, comment) VALUES (?, ?, ?, ?)
             ON CONFLICT(doctor_id, user_id)
             DO UPDATE SET rating = excluded.rating, comment = excluded.comment, created_at = CURRENT_TIMESTAMP'
        );
        $stmt->bindValue(1, $doctorId,    SQLITE3_INTEGER);
        $stmt->bindValue(2, $user['id'],  SQLITE3_INTEGER);
        $stmt->bindValue(3, $rating,      SQLITE3_INTEGER);
        $stmt->bindValue(4, $comment,     $comment === null ? SQLITE3_NULL : SQLITE3_TEXT);
        $stmt->execute();

        json_response(201, ['success' => true, 'id' => $db->lastInsertRowID()]);
    }

    // الجزء الثالث من الـ Backend: المسارات العامة (Public & User Routes)
// ============================================================
//
// الملف ده فيه كل الـ API Endpoints اللي بيستخدمها أي زائر أو مستخدم
// مسجّل دخول عادي (غير الأدمن). أي طلب جاي من الـ frontend بيمر هنا
// قبل ما يوصل لروتات الأدمن.
//
// أوّل خطوتين:
//   • $path   : بيستخرج المسار من الـ URL (مثال: /api/doctors).
//   • $method : نوع الـ HTTP request (GET / POST / PATCH / DELETE).
//
// المسارات الموجودة في الملف:
//
//   ━━ القراءة العامة (Public Reads) ━━
//   • GET  /api/doctors             : رجّع قائمة الأطباء (مرتّبين بالتقييم).
//   • GET  /api/clinics             : رجّع قائمة العيادات.
//
//   ━━ التسجيل والدخول (Authentication) ━━
//   • POST /api/register            : تسجيل مستخدم جديد بإيميل أو موبايل + باسوورد.
//                                     بيتأكد إن الإيميل مش مكرّر، وبيخزّن Hash للباسوورد.
//   • POST /api/login               : تسجيل دخول. فيه Rate Limit (max 10 محاولات
//                                     فاشلة كل 15 دقيقة لكل IP). بيرجّع token
//                                     مدّته 30 يوم.
//   • POST /api/logout              : إنهاء الجلسة الحالية وحذف الـ token من DB.
//   • GET  /api/me                  : رجّع بيانات المستخدم الحالي (لازم يكون
//                                     مسجّل دخول، بيقرأ الـ Bearer token).
//
//   ━━ الحجوزات (Bookings) ━━
//   • POST   /api/bookings          : إنشاء حجز جديد. لازم تسجيل دخول.
//                                     بيتحقق من بيانات المريض، الطبيب، التاريخ،
//                                     طريقة الدفع، نوع الخدمة (clinic / home_visit / video / chat).
//   • GET    /api/bookings          : قائمة الحجوزات بتاعة المستخدم الحالي.
//   • PATCH  /api/bookings/{id}     : تعديل حالة الحجز (مثلاً إلغاء من المستخدم).
//
//   ━━ تفاصيل الطبيب والتقييمات (Doctor Profile & Reviews) ━━
//   • GET  /api/doctors/{id}         : ملف الطبيب الكامل (مع الجدول والخدمات
//                                      والـ locations والمتوسط الحسابي للتقييمات).
//   • GET  /api/doctors/{id}/reviews : قائمة تقييمات الطبيب.
//   • POST /api/doctors/{id}/reviews : إضافة تقييم جديد (لازم تسجيل دخول).
//
// ملاحظة: لو الطلب مفيش له مطابق هنا، بيكمل للجزء الرابع (Admin Routes)
// وبعدها لو لسه مفيش مطابقة بيرجع 404.
// ============================================================