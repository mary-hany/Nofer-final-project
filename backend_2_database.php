<?php
// ============================================================
// الجزء الثاني من الـ Backend: تهيئة قاعدة البيانات (Database Bootstrap)
// ============================================================
//
// الملف ده مسؤول عن إنشاء وتجهيز كل الجداول في قاعدة بيانات SQLite
// أول ما السيرفر يشتغل. لو الجداول موجودة بالفعل بيتجاهلها (CREATE IF NOT EXISTS).
//
// الجداول اللي بيتم إنشاؤها:
//   1) doctors           : بيانات الأطباء (الاسم، التخصص، الموقع، السعر، التقييم،
//                          الإحداثيات الجغرافية).
//   2) clinics           : بيانات العيادات والمستشفيات.
//   3) users             : بيانات المستخدمين (إيميل، تليفون، Hash للباسوورد،
//                          صلاحية الأدمن is_admin).
//   4) sessions          : جلسات تسجيل الدخول (Token محفوظ مشفّر بالـ hash مع
//                          وقت انتهاء الصلاحية).
//   5) login_attempts    : محاولات تسجيل الدخول الفاشلة لمنع الـ Brute Force.
//   6) bookings          : الحجوزات (المريض، الطبيب، التاريخ، الوقت، طريقة الدفع،
//                          الحالة pending/confirmed/cancelled، نوع الخدمة).
//   7) reviews           : تقييمات الأطباء (عدد نجوم وتعليق).
//
// كمان الملف ده بيعمل:
//   • Migrations لقواعد بيانات قديمة (مثال: إضافة عمود is_admin لو مش موجود).
//   • Indexes علشان البحث يبقى أسرع.
//   • Seed Data: لو الجداول فاضية بيضيف بيانات تجريبية للأطباء والعيادات.
//   • تنضيف الجلسات المنتهية ومحاولات الدخول القديمة من وقت للتاني (Cleanup).
//
// ملاحظة: الملف ده بيُستدعى داخل بلوك try {} في الـ wrapper علشان أي مشكلة
// في قاعدة البيانات تتمسك وترجع 500 للمستخدم. متغير $db المعرّف هنا
// بيتم استخدامه في الأجزاء التالية (Public Routes و Admin Routes).
// ============================================================

    // مسار ملف قاعدة البيانات على القرص (نفس مجلد الـ backend).
    $dbFile = __DIR__ . '/clinics.db';

    $db = new SQLite3($dbFile);
    $db->enableExceptions(true);
    $db->busyTimeout(2000);
    $db->exec('PRAGMA foreign_keys = ON');

    $db->exec('CREATE TABLE IF NOT EXISTS doctors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        specialty TEXT NOT NULL,
        location TEXT NOT NULL,
        phone TEXT,
        price INTEGER DEFAULT 250,
        rating REAL DEFAULT 4.5,
        lat REAL,
        lng REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )');

    $db->exec('CREATE TABLE IF NOT EXISTS clinics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        specialty TEXT NOT NULL,
        location TEXT NOT NULL,
        phone TEXT,
        capacity INTEGER DEFAULT 50,
        rating REAL DEFAULT 4.0,
        lat REAL,
        lng REAL,
        website TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )');

    $db->exec('CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )');
    // Migrate older DBs that predate is_admin
    $userCols = [];
    $colsRes = $db->query('PRAGMA table_info(users)');
    while ($r = $colsRes->fetchArray(SQLITE3_ASSOC)) $userCols[] = $r['name'];
    if (!in_array('is_admin', $userCols, true)) {
        $db->exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
    }
    $db->exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL');
    $db->exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone) WHERE phone IS NOT NULL');

    $db->exec('CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)');

    $db->exec('CREATE TABLE IF NOT EXISTS login_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip TEXT NOT NULL,
        attempted_at INTEGER NOT NULL
    )');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_login_ip_time ON login_attempts(ip, attempted_at)');

    $db->exec('CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        doctor_id INTEGER NOT NULL,
        patient_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        date TEXT NOT NULL,
        payment_method TEXT NOT NULL DEFAULT "cash",
        notes TEXT,
        status TEXT DEFAULT "pending",
        service_type TEXT NOT NULL DEFAULT "clinic",
        location_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (doctor_id)   REFERENCES doctors(id),
        FOREIGN KEY (user_id)     REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (location_id) REFERENCES doctor_locations(id) ON DELETE SET NULL
    )');
    // Migrate older DBs that predate the service_type / location_id columns.
    $existingCols = [];
    $colsRes = $db->query('PRAGMA table_info(bookings)');
    while ($r = $colsRes->fetchArray(SQLITE3_ASSOC)) $existingCols[] = $r['name'];
    if (!in_array('service_type', $existingCols, true)) {
        $db->exec('ALTER TABLE bookings ADD COLUMN service_type TEXT NOT NULL DEFAULT "clinic"');
    }
    if (!in_array('location_id', $existingCols, true)) {
        $db->exec('ALTER TABLE bookings ADD COLUMN location_id INTEGER');
    }

    $db->exec('CREATE TABLE IF NOT EXISTS doctor_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doctor_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
        comment TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE
    )');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_reviews_doctor ON doctor_reviews(doctor_id)');
    // One review per user per doctor (latest wins via upsert in POST handler).
    $db->exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_unique ON doctor_reviews(doctor_id, user_id)');

    // ---------- Doctor locations (where each doctor practices) ----------
    $db->exec('CREATE TABLE IF NOT EXISTS doctor_locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doctor_id INTEGER NOT NULL,
        clinic_name TEXT NOT NULL,
        address TEXT NOT NULL,
        phone TEXT,
        price INTEGER,
        lat REAL,
        lng REAL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
    )');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_doctor_locations_doctor ON doctor_locations(doctor_id)');

    // ---------- Per-location weekly schedule ----------
    // day_of_week: 0=Sunday ... 6=Saturday (matches JS Date.getDay()).
    // start_time / end_time: "HH:MM" 24-hour.
    $db->exec('CREATE TABLE IF NOT EXISTS location_schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_id INTEGER NOT NULL,
        day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        FOREIGN KEY (location_id) REFERENCES doctor_locations(id) ON DELETE CASCADE
    )');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_schedules_location ON location_schedules(location_id)');

    // ---------- Additional services per doctor (home visit, video, chat) ----------
    // service_type ∈ {"home_visit", "video", "chat"}.
    // available_hours / description are optional human-readable notes.
    $db->exec('CREATE TABLE IF NOT EXISTS doctor_services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doctor_id INTEGER NOT NULL,
        service_type TEXT NOT NULL CHECK(service_type IN ("home_visit","video","chat")),
        is_available INTEGER NOT NULL DEFAULT 1,
        price INTEGER,
        available_hours TEXT,
        description TEXT,
        FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
    )');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_doctor_services_doctor ON doctor_services(doctor_id)');
    $db->exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_doctor_services_unique ON doctor_services(doctor_id, service_type)');

    // ---------- Default admin seed ----------
    // Creates a default admin only if NO admin exists yet.
    // CHANGE THESE CREDENTIALS in production.
    $adminCount = $db->querySingle('SELECT COUNT(*) FROM users WHERE is_admin = 1');
    if ((int)$adminCount === 0) {
        $defaultEmail = 'admin@nofer.local';
        $existing = $db->querySingle("SELECT id FROM users WHERE email = '$defaultEmail'");
        if (!$existing) {
            $hash = password_hash('admin123', PASSWORD_DEFAULT);
            $seed = $db->prepare(
                'INSERT INTO users (name, email, password_hash, is_admin) VALUES (?, ?, ?, 1)'
            );
            $seed->bindValue(1, 'مدير النظام', SQLITE3_TEXT);
            $seed->bindValue(2, $defaultEmail,  SQLITE3_TEXT);
            $seed->bindValue(3, $hash,          SQLITE3_TEXT);
            $seed->execute();
        } else {
            $db->exec("UPDATE users SET is_admin = 1 WHERE email = '$defaultEmail'");
        }
    }

    // ---------- Doctor catalog seed ----------
    // The frontend uses doctor ids 1..150 (6 hand-curated + 144 generated). Make sure
    // every id the frontend can reference exists in the DB, so bookings/reviews work.
    // We only fill in MISSING ids — manually-added doctors are never overwritten.
    $maxIdRow = $db->querySingle('SELECT MAX(id) AS max_id FROM doctors', true);
    $currentMax = (int)($maxIdRow['max_id'] ?? 0);
    if ($currentMax < 150) {
        // Match the frontend's clinicData.doctors exactly for ids 1..6
        $curated = [
            [1, 'د. أحمد محمد',    'جراحة العظام',     'حلوان - ١٥ شارع مصطفى صفوت',         4.9],
            [2, 'د. فاطمة علي',    'طب الأطفال',       'المعادي - شارع اللاسلكي',             4.8],
            [3, 'د. محمد صالح',    'الأمراض الداخلية', 'مصر الجديدة - النزهة الجديدة',         5.0],
            [4, 'د. سارة حسن',     'الجلدية',          'حدائق حلوان - شارع جمال عبدالناصر',   4.7],
            [5, 'د. خالد عبدالله', 'الأنف والأذن',     'وسط البلد - شارع ٢٦ يوليو',           4.9],
            [6, 'د. نور السيد',    'النساء والتوليد',  'حلوان - شارع المحطة',                 4.8],
        ];

        // Match the frontend's generated doctors (ids 7..150)
        $addresses = [
            'مدينة نصر - ١٢ رمسيس، القاهرة ١١٧٥٧',
            'المعادي - ٢٣ كورنيش النيل، القاهرة ١١٤٣١',
            'التجمع الخامس - ٩٠ شارع التسعين، القاهرة ١١٨٣٥',
            'الزمالك - ٥ الشيخ يوسف، القاهرة ١١٢١١',
            'مصر الجديدة - ٨ الحجاز، القاهرة ١١٧٧١',
            'الدقي - ٢٠ النهضة، الجيزة ١٢٣١١',
            'المهندسين - ٤٢ جامعة الدول، الجيزة ١٢٦١١',
            'الهرم - ٧٥ شارع الهرم، الجيزة ١٢٥١١',
            'عين شمس - العباسية، القاهرة ١١٥٦٦',
            'شبرا - شارع شبرا ٣٠، القاهرة ١١٦٤٣',
        ];
        $firstNames = ['ياسر', 'هند', 'عمرو', 'رنا', 'سامي', 'هبة', 'كريم', 'نوال', 'طارق', 'لمى', 'باسم', 'جود', 'سيد', 'رانيا', 'فادي', 'داليا'];
        $lastNames  = ['الشربيني', 'السيد', 'عبدالرحمن', 'محمد', 'حسن', 'علي', 'إبراهيم', 'صلاح'];
        $specialties = [
            'جراحة العظام', 'طب الأطفال', 'الأمراض الداخلية', 'الجلدية',
            'الأنف والأذن', 'النساء والتوليد', 'طب العيون', 'طب الأسنان',
            'المخ والأعصاب', 'أمراض القلب', 'الجهاز الهضمي', 'الكلى والبولية',
        ];

        $db->exec('BEGIN');
        try {
            // Curated 1..6
            foreach ($curated as $c) {
                [$id, $name, $spec, $loc, $rating] = $c;
                $ins = $db->prepare(
                    'INSERT OR IGNORE INTO doctors (id, name, specialty, location, phone, price, rating, lat, lng)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
                );
                $ins->bindValue(1, $id,           SQLITE3_INTEGER);
                $ins->bindValue(2, $name,         SQLITE3_TEXT);
                $ins->bindValue(3, $spec,         SQLITE3_TEXT);
                $ins->bindValue(4, $loc,          SQLITE3_TEXT);
                $ins->bindValue(5, '01000000000', SQLITE3_TEXT);
                $ins->bindValue(6, 300,           SQLITE3_INTEGER);
                $ins->bindValue(7, $rating,       SQLITE3_FLOAT);
                $ins->bindValue(8, 30.04,         SQLITE3_FLOAT);
                $ins->bindValue(9, 31.24,         SQLITE3_FLOAT);
                $ins->execute();
                $ins->close();
            }
            // Generated 7..150 (match frontend exactly)
            for ($i = 7; $i <= 150; $i++) {
                $fn   = $firstNames[($i * 7) % count($firstNames)];
                $ln   = $lastNames[($i * 3)  % count($lastNames)];
                $spec = $specialties[($i - 1) % count($specialties)];
                $loc  = $addresses[($i - 1)  % count($addresses)];
                $rating = round(4.2 + (($i * 17) % 9) / 10, 1);
                $lat = 30.04 + ((($i * 13) % 100) - 50) / 1000;
                $lng = 31.24 + ((($i * 11) % 100) - 50) / 1000;

                $ins = $db->prepare(
                    'INSERT OR IGNORE INTO doctors (id, name, specialty, location, phone, price, rating, lat, lng)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
                );
                $ins->bindValue(1, $i,             SQLITE3_INTEGER);
                $ins->bindValue(2, "د. $fn $ln",   SQLITE3_TEXT);
                $ins->bindValue(3, $spec,          SQLITE3_TEXT);
                $ins->bindValue(4, $loc,           SQLITE3_TEXT);
                $ins->bindValue(5, '01000000000',  SQLITE3_TEXT);
                $ins->bindValue(6, 300,            SQLITE3_INTEGER);
                $ins->bindValue(7, $rating,        SQLITE3_FLOAT);
                $ins->bindValue(8, $lat,           SQLITE3_FLOAT);
                $ins->bindValue(9, $lng,           SQLITE3_FLOAT);
                $ins->execute();
                $ins->close();
            }
            $db->exec('COMMIT');
        } catch (Throwable $e) {
            $db->exec('ROLLBACK');
            error_log('[nofer] doctor seed failed: ' . $e->getMessage());
        }
    }

    // ---------- Clinic catalog seed ----------
    // The clinics table powers the "أفضل المستشفيات والمراكز الطبية" section.
    // If the table is empty (fresh DB, or DB built before the catalog was added),
    // populate it with a curated list of well-known Cairo/Giza hospitals + centers.
    // Manual additions are never overwritten — we only seed when the table is empty.
    $clinicCount = (int)$db->querySingle('SELECT COUNT(*) FROM clinics');
    if ($clinicCount === 0) {
        $clinicSeed = [
            // Original entries
            ['مستشفى الراعي الصالح',              'مستشفى',   'عام',          '١٥ شارع الهرم - الهرم - الجيزة ١٢٥١١',                '02-37608888', 250, 4.5, 29.9993, 31.1957, ''],
            ['مركز لوقا الطبي',                    'مركز طبي', 'متخصص',        '١٠ شارع رمسيس - العباسية - القاهرة ١١٥٦٦',            '02-26812345',  80, 4.6, 30.0750, 31.2686, 'luka-medical.com'],
            ['مستشفى شبرا العام',                  'مستشفى',   'عام',          'شبرا - ٤٠ شارع الترعة - القاهرة ١١٦٤٣',                '02-24367890', 400, 4.1, 30.0861, 31.2434, ''],
            ['مستشفى الدمرداش التعليمي',            'مستشفى',   'عام',          'العباسية - شارع الدمرداش - القاهرة ١١٧٥٧',             '02-26055255', 800, 4.3, 30.0889, 31.2922, 'demerdash.edu.eg'],
            ['مستشفى سانت تريزا',                  'مستشفى',   'عام',          'شبرا - ١٠ شارع سانت تريزا - القاهرة ١١٦٤٣',           '02-24320000', 150, 4.7, 30.0850, 31.2450, ''],
            ['مستشفى مارمرقس',                     'مستشفى',   'عام',          '١٠ شارع مارمرقس - مصر الجديدة - القاهرة ١١٧٧١',       '02-24123456', 200, 4.4, 30.0400, 31.3200, ''],
            ['مستشفى السلام الدولي',               'مستشفى',   'عام',          '٢٥ شارع كورنيش النيل - المعادي - القاهرة ١١٤٣١',       '02-25240077', 350, 4.6, 29.9656, 31.2542, 'alsalamhospital.com'],
            ['مستشفى الدفاع الجوي التخصصي',         'مستشفى',   'متخصص',        'مدينة نصر - شارع ستار الخير - القاهرة ١١٧٧١',          '02-24051234', 300, 4.2, 30.0600, 31.3100, ''],
            // Major private hospitals
            ['مستشفى دار الفؤاد',                   'مستشفى',   'متخصص',        'مدينة نصر - شارع مكرم عبيد - القاهرة',                '02-26909000', 350, 4.8, 30.0626, 31.3247, 'darelfouad.com'],
            ['مستشفى السعودي الألماني',             'مستشفى',   'عام',          'التجمع الخامس - شارع التسعين الجنوبي - القاهرة',       '02-26144444', 500, 4.7, 30.0148, 31.4275, 'sghgroup.com'],
            ['مستشفى كليوباترا',                    'مستشفى',   'عام',          'مصر الجديدة - شارع كليوباترا - القاهرة ١١٧٧١',         '02-22697799', 280, 4.5, 30.0978, 31.3296, 'cleopatrahospitals.com'],
            ['مستشفى النيل بدراوي',                  'مستشفى',   'عام',          'كورنيش النيل - المعادي - القاهرة ١١٤٣١',                '02-25240212', 240, 4.6, 29.9521, 31.2487, 'nileurhospital.com'],
            ['مستشفى كليوباترا التجمع',              'مستشفى',   'عام',          'التجمع الخامس - شارع التسعين الجنوبي - القاهرة',       '02-26183100', 220, 4.5, 30.0192, 31.4341, 'cleopatrahospitals.com'],
            ['مستشفى الجلاء التعليمي',              'مستشفى',   'نساء وتوليد',  'الجلاء - وسط البلد - القاهرة ١١٥١١',                   '02-25770007', 450, 4.0, 30.0500, 31.2400, ''],
            ['المستشفى الإيطالي',                    'مستشفى',   'عام',          'شبرا - ميدان عبدالحميد لطفي - القاهرة ١١٦٤٣',          '02-24585577', 180, 4.3, 30.0750, 31.2400, ''],
            ['مستشفى أهل مصر للحروق',                'مستشفى',   'متخصص',        'القطامية - شارع ٩٠ - القاهرة الجديدة',                  '02-25320005', 200, 4.7, 29.9978, 31.4567, 'ahlmasr.org'],
            // Specialty centers
            ['معهد القلب القومي',                    'مستشفى',   'قلب',          'إمبابة - الكورنيش - الجيزة ١٢٦٥١',                      '02-33371007', 600, 4.4, 30.0820, 31.2065, 'nhi.gov.eg'],
            ['معهد ناصر للأبحاث والعلاج',            'مستشفى',   'عام',          'شبرا - شارع الترعة البولاقية - القاهرة',                '02-24319111', 700, 4.2, 30.0890, 31.2470, ''],
            ['مستشفى ٥٧٣٥٧ لعلاج سرطان الأطفال',      'مستشفى',   'أورام',        'السيدة زينب - الكورنيش - القاهرة ١١٤١١',                '02-25351500', 320, 4.9, 30.0150, 31.2350, '57357.org'],
            ['المعهد القومي للأورام',                'مستشفى',   'أورام',        'فم الخليج - السيدة زينب - القاهرة',                     '02-23644720', 500, 4.3, 30.0167, 31.2389, 'nci.cu.edu.eg'],
            ['مستشفى الرمد التخصصي',                  'مستشفى',   'عيون',         'روض الفرج - شارع روض الفرج - القاهرة ١١٦٢١',            '02-24582101', 220, 4.4, 30.0900, 31.2380, ''],
            ['مركز مغربي للعيون',                    'مركز طبي', 'عيون',         'المهندسين - شارع شهاب - الجيزة ١٢٦١١',                  '02-37623040', 100, 4.7, 30.0606, 31.2058, 'magrabi.com.eg'],
            ['مركز نور الحياة لعلاج العقم',          'مركز طبي', 'نساء وتوليد',  'المهندسين - شارع جامعة الدول العربية - الجيزة',         '02-33361234',  60, 4.6, 30.0581, 31.2018, ''],
            ['مركز السلام لجراحة المخ والأعصاب',      'مركز طبي', 'متخصص',        'مدينة نصر - شارع مكرم عبيد - القاهرة',                  '02-22745500',  80, 4.5, 30.0640, 31.3260, ''],
            // Additional hospitals
            ['مستشفى السلام الدولي - التجمع',         'مستشفى',   'عام',          'التجمع الخامس - الحي الأول - القاهرة الجديدة',           '02-26181111', 400, 4.6, 30.0220, 31.4180, 'alsalamhospital.com'],
            ['مستشفى الصفوة',                        'مستشفى',   'عام',          'حدائق الأهرام - شارع الجيش - الجيزة',                    '02-38380101', 150, 4.4, 29.9700, 31.1450, ''],
            ['مستشفى دار العيون',                    'مستشفى',   'عيون',         'حدائق الأهرام - شارع جاردينيا - الجيزة',                 '02-38384700', 120, 4.5, 29.9720, 31.1480, ''],
            ['مستشفى الكرمة للنساء والتوليد',         'مستشفى',   'نساء وتوليد',  'التجمع الخامس - حي النرجس - القاهرة الجديدة',            '02-26171717', 100, 4.6, 30.0250, 31.4400, ''],
            ['مستشفى تبارك للأطفال',                  'مستشفى',   'أطفال',        'التجمع الخامس - الحي الأول - القاهرة الجديدة',           '02-26181144', 130, 4.5, 30.0240, 31.4190, ''],
            ['مستشفى كوينز للنساء والتوليد',          'مستشفى',   'نساء وتوليد',  'حدائق الأهرام - البوابة الثالثة - الجيزة',               '02-38385000',  90, 4.4, 29.9710, 31.1460, ''],
            // Mohandessin, Dokki, Heliopolis, October City
            ['مستشفى المهندسين',                     'مستشفى',   'عام',          'المهندسين - شارع جامعة الدول العربية - الجيزة',          '02-33450707', 200, 4.3, 30.0590, 31.2030, ''],
            ['مستشفى الدقي التخصصي',                  'مستشفى',   'متخصص',        'الدقي - شارع التحرير - الجيزة ١٢٣١١',                    '02-37606060', 180, 4.4, 30.0395, 31.2126, ''],
            ['مستشفى مصر الدولي',                    'مستشفى',   'عام',          'الدقي - شارع البطل أحمد عبدالعزيز - الجيزة',             '02-33358000', 220, 4.5, 30.0410, 31.2100, 'misrhospital.com'],
            ['مستشفى هليوبوليس',                     'مستشفى',   'عام',          'مصر الجديدة - شارع الميرغني - القاهرة ١١٧٧١',            '02-22906090', 200, 4.4, 30.0900, 31.3220, ''],
            ['مستشفى ٦ أكتوبر التخصصي',               'مستشفى',   'عام',          'مدينة ٦ أكتوبر - الحي الأول - الجيزة ١٢٥٧٣',             '02-38371234', 250, 4.5, 29.9285, 30.9188, ''],
            ['مستشفى الشيخ زايد التخصصي',            'مستشفى',   'متخصص',        'مدينة الشيخ زايد - الحي الأول - الجيزة',                 '02-38500900', 300, 4.6, 30.0610, 30.9700, ''],
        ];

        $db->exec('BEGIN');
        try {
            $ins = $db->prepare(
                'INSERT INTO clinics (name, type, specialty, location, phone, capacity, rating, lat, lng, website)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            );
            foreach ($clinicSeed as $c) {
                $ins->bindValue(1,  $c[0], SQLITE3_TEXT);
                $ins->bindValue(2,  $c[1], SQLITE3_TEXT);
                $ins->bindValue(3,  $c[2], SQLITE3_TEXT);
                $ins->bindValue(4,  $c[3], SQLITE3_TEXT);
                $ins->bindValue(5,  $c[4], SQLITE3_TEXT);
                $ins->bindValue(6,  $c[5], SQLITE3_INTEGER);
                $ins->bindValue(7,  $c[6], SQLITE3_FLOAT);
                $ins->bindValue(8,  $c[7], SQLITE3_FLOAT);
                $ins->bindValue(9,  $c[8], SQLITE3_FLOAT);
                $ins->bindValue(10, $c[9], SQLITE3_TEXT);
                $ins->execute();
                $ins->reset();
            }
            $ins->close();
            $db->exec('COMMIT');
        } catch (Throwable $e) {
            $db->exec('ROLLBACK');
            error_log('[nofer] clinic seed failed: ' . $e->getMessage());
        }
    }

    // Best-effort housekeeping: prune expired sessions + old attempts (1 in 50 requests)
    if (random_int(1, 50) === 1) {
        $db->exec('DELETE FROM sessions WHERE expires_at < strftime("%s","now")');
        $db->exec('DELETE FROM login_attempts WHERE attempted_at < strftime("%s","now") - ' . (LOGIN_RATE_LIMIT_WINDOW * 4));
    }
