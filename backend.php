<?php
// Nofer Backend API - PHP + SQLite3
// Auth-enabled: email/phone + password, server-side sessions, booking requires auth.

declare(strict_types=1);

// ---------- Configuration ----------
const ALLOWED_ORIGINS = [
      'http://localhost',
    'http://localhost:8000',
    'http://127.0.0.1',
    'http://127.0.0.1:8000',
    'http://localhost:5500',     
    'http://127.0.0.1:5500',   
    // Add your production origin(s) here, e.g. 'https://nofer.example.com'
];

const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 30; // 30 days
const LOGIN_RATE_LIMIT_WINDOW  = 60 * 15;           // 15 min
const LOGIN_RATE_LIMIT_MAX     = 10;                // max failed attempts per IP per window
const ALLOWED_PAYMENT_METHODS  = ['visa', 'fawry', 'paypal', 'vodafone_cash', 'cash'];

// ---------- Headers / CORS ----------
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && in_array($origin, ALLOWED_ORIGINS, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Credentials: true');
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit(0);
}

// ---------- Helpers ----------
function json_response(int $status, array $payload): void {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function read_json_body(): array {
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function str_length(string $value): int {
    if (function_exists('mb_strlen')) return mb_strlen($value, 'UTF-8');
    return preg_match_all('/./u', $value);
}

function clean_string($value, int $maxLen, bool $allowEmpty = false): ?string {
    if ($value === null) return $allowEmpty ? '' : null;
    if (!is_string($value)) return null;
    $value = trim($value);
    if ($value === '') return $allowEmpty ? '' : null;
    if (str_length($value) > $maxLen) return null;
    if (preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', $value)) return null;
    return $value;
}

function valid_email(string $email): bool {
    return (bool) filter_var($email, FILTER_VALIDATE_EMAIL) && str_length($email) <= 200;
}

function valid_phone(string $phone): bool {
    return (bool) preg_match('/^\+?[0-9]{7,15}$/', $phone);
}

function valid_date(string $date): bool {
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) return false;
    $d = DateTime::createFromFormat('Y-m-d', $date);
    if (!$d || $d->format('Y-m-d') !== $date) return false;
    return $d >= new DateTime('today');
}

function client_ip(): string {
    // Trust REMOTE_ADDR only. If you sit behind a known proxy, sanitize X-Forwarded-For.
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}

function generate_token(): string {
    return bin2hex(random_bytes(32)); // 64 hex chars
}

function hash_token(string $token): string {
    // We store only the hash. A DB leak does not grant access.
    return hash('sha256', $token);
}

function bearer_token(): ?string {
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if ($auth === '' && function_exists('apache_request_headers')) {
        $h = apache_request_headers();
        $auth = $h['Authorization'] ?? $h['authorization'] ?? '';
    }
    if (preg_match('/^Bearer\s+([A-Fa-f0-9]{64})$/', $auth, $m)) return $m[1];
    return null;
}

function current_user(SQLite3 $db): ?array {
    $token = bearer_token();
    if ($token === null) return null;
    $stmt = $db->prepare(
        'SELECT u.id, u.name, u.email, u.phone
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > strftime("%s","now")
         LIMIT 1'
    );
    $stmt->bindValue(1, hash_token($token), SQLITE3_TEXT);
    $row = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    return $row ?: null;
}

function require_auth(SQLite3 $db): array {
    $user = current_user($db);
    if (!$user) json_response(401, ['success' => false, 'error' => 'Authentication required']);
    return $user;
}

function require_admin(SQLite3 $db): array {
    $user = require_auth($db);
    if ((int)($user['is_admin'] ?? 0) !== 1) {
        json_response(403, ['success' => false, 'error' => 'يتطلب صلاحيات المدير']);
    }
    return $user;
}

function login_is_throttled(SQLite3 $db, string $ip): bool {
    $cutoff = time() - LOGIN_RATE_LIMIT_WINDOW;
    $stmt = $db->prepare('SELECT COUNT(*) AS c FROM login_attempts WHERE ip = ? AND attempted_at > ?');
    $stmt->bindValue(1, $ip, SQLITE3_TEXT);
    $stmt->bindValue(2, $cutoff, SQLITE3_INTEGER);
    $row = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    return ((int) ($row['c'] ?? 0)) >= LOGIN_RATE_LIMIT_MAX;
}

function record_failed_login(SQLite3 $db, string $ip): void {
    $stmt = $db->prepare('INSERT INTO login_attempts (ip, attempted_at) VALUES (?, ?)');
    $stmt->bindValue(1, $ip, SQLITE3_TEXT);
    $stmt->bindValue(2, time(), SQLITE3_INTEGER);
    $stmt->execute();
}

function clear_failed_logins(SQLite3 $db, string $ip): void {
    $stmt = $db->prepare('DELETE FROM login_attempts WHERE ip = ?');
    $stmt->bindValue(1, $ip, SQLITE3_TEXT);
    $stmt->execute();
}

function issue_session(SQLite3 $db, int $userId): array {
    $token = generate_token();
    $now = time();
    $exp = $now + SESSION_LIFETIME_SECONDS;
    $sess = $db->prepare('INSERT INTO sessions (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)');
    $sess->bindValue(1, $userId, SQLITE3_INTEGER);
    $sess->bindValue(2, hash_token($token), SQLITE3_TEXT);
    $sess->bindValue(3, $now, SQLITE3_INTEGER);
    $sess->bindValue(4, $exp, SQLITE3_INTEGER);
    $sess->execute();
    return ['token' => $token, 'expires_at' => $exp];
}

// ---------- DB bootstrap ----------
$dbFile = __DIR__ . '/clinics.db';

try {
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

    // Best-effort housekeeping: prune expired sessions + old attempts (1 in 50 requests)
    if (random_int(1, 50) === 1) {
        $db->exec('DELETE FROM sessions WHERE expires_at < strftime("%s","now")');
        $db->exec('DELETE FROM login_attempts WHERE attempted_at < strftime("%s","now") - ' . (LOGIN_RATE_LIMIT_WINDOW * 4));
    }

    // ---------- Routing ----------
    $path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '';
    $path = preg_replace('#^.*backend\.php#', '', $path);
    $method = $_SERVER['REQUEST_METHOD'];

    // ----- Public reads -----
    if ($path === '/api/doctors' && $method === 'GET') {
        $result = $db->query('SELECT * FROM doctors ORDER BY rating DESC LIMIT 50');
        $rows = [];
        while ($row = $result->fetchArray(SQLITE3_ASSOC)) $rows[] = $row;
        json_response(200, ['success' => true, 'doctors' => $rows]);
    }

    if ($path === '/api/clinics' && $method === 'GET') {
        $result = $db->query('SELECT * FROM clinics ORDER BY rating DESC LIMIT 50');
        $rows = [];
        while ($row = $result->fetchArray(SQLITE3_ASSOC)) $rows[] = $row;
        json_response(200, ['success' => true, 'clinics' => $rows]);
    }

    // ----- Auth: register -----
    if ($path === '/api/register' && $method === 'POST') {
        $input = read_json_body();
        $name     = clean_string($input['name']  ?? null, 200);
        $email    = clean_string($input['email'] ?? null, 200, true);
        $phone    = clean_string($input['phone'] ?? null, 20,  true);
        $password = isset($input['password']) && is_string($input['password']) ? $input['password'] : '';

        if ($name === null) json_response(400, ['success' => false, 'error' => 'Invalid name']);
        if ($email === '' && $phone === '') {
            json_response(400, ['success' => false, 'error' => 'Email or phone required']);
        }
        if ($email !== '' && !valid_email($email)) json_response(400, ['success' => false, 'error' => 'Invalid email']);
        if ($phone !== '' && !valid_phone($phone)) json_response(400, ['success' => false, 'error' => 'Invalid phone']);
        // Don't trim password: leading/trailing spaces are allowed
        if (strlen($password) < 8 || strlen($password) > 128) {
            json_response(400, ['success' => false, 'error' => 'Password must be 8-128 characters']);
        }

        if ($email !== '') {
            $chk = $db->prepare('SELECT 1 FROM users WHERE email = ? LIMIT 1');
            $chk->bindValue(1, $email, SQLITE3_TEXT);
            if ($chk->execute()->fetchArray()) {
                json_response(409, ['success' => false, 'error' => 'Email already registered']);
            }
        }
        if ($phone !== '') {
            $chk = $db->prepare('SELECT 1 FROM users WHERE phone = ? LIMIT 1');
            $chk->bindValue(1, $phone, SQLITE3_TEXT);
            if ($chk->execute()->fetchArray()) {
                json_response(409, ['success' => false, 'error' => 'Phone already registered']);
            }
        }

        $hash = password_hash($password, PASSWORD_DEFAULT);
        if ($hash === false) json_response(500, ['success' => false, 'error' => 'Internal server error']);

        $stmt = $db->prepare('INSERT INTO users (name, email, phone, password_hash) VALUES (?, ?, ?, ?)');
        $stmt->bindValue(1, $name, SQLITE3_TEXT);
        $stmt->bindValue(2, $email !== '' ? $email : null, $email !== '' ? SQLITE3_TEXT : SQLITE3_NULL);
        $stmt->bindValue(3, $phone !== '' ? $phone : null, $phone !== '' ? SQLITE3_TEXT : SQLITE3_NULL);
        $stmt->bindValue(4, $hash, SQLITE3_TEXT);
        $stmt->execute();
        $userId = (int) $db->lastInsertRowID();

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
                'is_admin' => true,
            ],
        ]);
    }

    // ----- Auth: login -----
    if ($path === '/api/login' && $method === 'POST') {
        $ip = client_ip();
        if (login_is_throttled($db, $ip)) {
            json_response(429, ['success' => false, 'error' => 'Too many attempts. Try again later.']);
        }

        $input      = read_json_body();
        $identifier = clean_string($input['identifier'] ?? null, 200);
        $password   = isset($input['password']) && is_string($input['password']) ? $input['password'] : '';

        if ($identifier === null || $password === '') {
            record_failed_login($db, $ip);
            json_response(400, ['success' => false, 'error' => 'Invalid credentials']);
        }

        $stmt = $db->prepare('SELECT id, name, email, phone, password_hash FROM users WHERE email = ? OR phone = ? LIMIT 1');
        $stmt->bindValue(1, $identifier, SQLITE3_TEXT);
        $stmt->bindValue(2, $identifier, SQLITE3_TEXT);
        $user = $stmt->execute()->fetchArray(SQLITE3_ASSOC);

        if (!$user || !password_verify($password, $user['password_hash'])) {
            record_failed_login($db, $ip);
            json_response(401, ['success' => false, 'error' => 'Invalid credentials']);
        }

        if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
            $newHash = password_hash($password, PASSWORD_DEFAULT);
            if ($newHash !== false) {
                $u = $db->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
                $u->bindValue(1, $newHash, SQLITE3_TEXT);
                $u->bindValue(2, $user['id'], SQLITE3_INTEGER);
                $u->execute();
            }
        }

        clear_failed_logins($db, $ip);
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
                'is_admin' => (int)($user['is_admin'] ?? 0) === 1,
            ],
        ]);
    }

    // ----- Auth: logout (invalidates current token) -----
    if ($path === '/api/logout' && $method === 'POST') {
        $token = bearer_token();
        if ($token !== null) {
            $stmt = $db->prepare('DELETE FROM sessions WHERE token_hash = ?');
            $stmt->bindValue(1, hash_token($token), SQLITE3_TEXT);
            $stmt->execute();
        }
        json_response(200, ['success' => true]);
    }

    // ----- Auth: me -----
    if ($path === '/api/me' && $method === 'GET') {
        $user = current_user($db);
        if (!$user) json_response(401, ['success' => false, 'error' => 'Not authenticated']);
        json_response(200, ['success' => true, 'user' => [
            'id'       => $user['id'],
            'name'     => $user['name'],
            'email'    => $user['email'],
            'phone'    => $user['phone'],
            'is_admin' => (int)($user['is_admin'] ?? 0) === 1,
        ]]);
    }

    // ----- Bookings: create (auth required) -----
    if ($path === '/api/bookings' && $method === 'POST') {
        $user = require_auth($db);
        $input = read_json_body();

        $doctorId    = filter_var($input['doctor_id'] ?? null, FILTER_VALIDATE_INT);
        $patientName = clean_string($input['patient_name']   ?? null, 200);
        $phone       = clean_string($input['phone']          ?? null, 20);
        $date        = clean_string($input['date']           ?? null, 10);
        $payment     = clean_string($input['payment_method'] ?? 'cash', 30);
        $notes       = clean_string($input['notes']          ?? null, 500, true);
        $serviceType = clean_string($input['service_type']   ?? 'clinic', 20);
        $locationId  = isset($input['location_id'])
            ? filter_var($input['location_id'], FILTER_VALIDATE_INT) : null;

        if ($doctorId === false || $doctorId === null || $doctorId <= 0) {
            json_response(400, ['success' => false, 'error' => 'Invalid doctor_id']);
        }
        if ($patientName === null) json_response(400, ['success' => false, 'error' => 'Invalid patient_name']);
        if ($phone === null || !valid_phone($phone)) json_response(400, ['success' => false, 'error' => 'Invalid phone']);
        if ($date === null || !valid_date($date)) json_response(400, ['success' => false, 'error' => 'Invalid date']);
        if ($payment === null || !in_array($payment, ALLOWED_PAYMENT_METHODS, true)) {
            json_response(400, ['success' => false, 'error' => 'Invalid payment_method']);
        }
        if ($notes === null) json_response(400, ['success' => false, 'error' => 'Invalid notes']);
        if (!in_array($serviceType, ['clinic', 'home_visit', 'video', 'chat'], true)) {
            json_response(400, ['success' => false, 'error' => 'Invalid service_type']);
        }
        // location_id only meaningful for clinic visits
        if ($serviceType !== 'clinic') $locationId = null;
        if ($locationId === false) $locationId = null;

        $check = $db->prepare('SELECT 1 FROM doctors WHERE id = ?');
        $check->bindValue(1, $doctorId, SQLITE3_INTEGER);
        if (!$check->execute()->fetchArray(SQLITE3_ASSOC)) {
            json_response(404, ['success' => false, 'error' => 'Doctor not found']);
        }

        // For the 3 add-on services, refuse the booking if the doctor doesn't offer it.
        if (in_array($serviceType, ['home_visit', 'video', 'chat'], true)) {
            $svc = $db->prepare(
                'SELECT is_available FROM doctor_services
                 WHERE doctor_id = ? AND service_type = ?'
            );
            $svc->bindValue(1, $doctorId,    SQLITE3_INTEGER);
            $svc->bindValue(2, $serviceType, SQLITE3_TEXT);
            $row = $svc->execute()->fetchArray(SQLITE3_ASSOC);
            if (!$row || (int)$row['is_available'] !== 1) {
                json_response(400, [
                    'success' => false,
                    'error'   => 'هذه الخدمة غير متاحة لهذا الطبيب حالياً'
                ]);
            }
        }

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
        if ($locationId === null) {
            $stmt->bindValue(9, null, SQLITE3_NULL);
        } else {
            $stmt->bindValue(9, $locationId, SQLITE3_INTEGER);
        }
        $stmt->execute();

        json_response(201, ['success' => true, 'id' => $db->lastInsertRowID()]);
    }

    // ----- Bookings: list mine (auth required) -----
    if ($path === '/api/bookings' && $method === 'GET') {
        $user = require_auth($db);
        $stmt = $db->prepare(
            'SELECT b.id, b.doctor_id, b.patient_name, b.phone, b.date, b.payment_method,
                    b.notes, b.status, b.created_at, d.name AS doctor_name, d.specialty
             FROM bookings b LEFT JOIN doctors d ON d.id = b.doctor_id
             WHERE b.user_id = ?
             ORDER BY b.created_at DESC'
        );
        $stmt->bindValue(1, $user['id'], SQLITE3_INTEGER);
        $res = $stmt->execute();
        $rows = [];
        while ($row = $res->fetchArray(SQLITE3_ASSOC)) $rows[] = $row;
        json_response(200, ['success' => true, 'bookings' => $rows]);
    }

    // ----- Doctor profile (public) -----
    // GET /api/doctors/{id}  → doctor + reviews + aggregate
    if ($method === 'GET' && preg_match('#^/api/doctors/(\d+)$#', $path, $m)) {
        $doctorId = (int)$m[1];

        // Note: the frontend "filler" doctors aren't in the DB. Backend returns
        // null for `doctor` in that case; the frontend falls back to its local copy.
        $stmt = $db->prepare('SELECT * FROM doctors WHERE id = ?');
        $stmt->bindValue(1, $doctorId, SQLITE3_INTEGER);
        $doctor = $stmt->execute()->fetchArray(SQLITE3_ASSOC) ?: null;

        $stmt = $db->prepare(
            'SELECT r.id, r.rating, r.comment, r.created_at, u.name AS user_name
             FROM doctor_reviews r
             JOIN users u ON u.id = r.user_id
             WHERE r.doctor_id = ?
             ORDER BY r.created_at DESC
             LIMIT 100'
        );
        $stmt->bindValue(1, $doctorId, SQLITE3_INTEGER);
        $res = $stmt->execute();
        $reviews = [];
        while ($row = $res->fetchArray(SQLITE3_ASSOC)) $reviews[] = $row;

        $stmt = $db->prepare(
            'SELECT COUNT(*) AS count, COALESCE(AVG(rating), 0) AS avg_rating
             FROM doctor_reviews WHERE doctor_id = ?'
        );
        $stmt->bindValue(1, $doctorId, SQLITE3_INTEGER);
        $agg = $stmt->execute()->fetchArray(SQLITE3_ASSOC);

        // Locations
        $stmt = $db->prepare(
            'SELECT id, clinic_name, address, phone, price, lat, lng
             FROM doctor_locations
             WHERE doctor_id = ?
             ORDER BY sort_order ASC, id ASC'
        );
        $stmt->bindValue(1, $doctorId, SQLITE3_INTEGER);
        $res = $stmt->execute();
        $locations = [];
        $locationIds = [];
        while ($row = $res->fetchArray(SQLITE3_ASSOC)) {
            $row['schedule'] = []; // filled below
            $locations[] = $row;
            $locationIds[] = (int)$row['id'];
        }

        // Schedules for those locations (one query, then group in PHP)
        if (!empty($locationIds)) {
            $placeholders = implode(',', array_fill(0, count($locationIds), '?'));
            $stmt = $db->prepare(
                "SELECT location_id, day_of_week, start_time, end_time
                 FROM location_schedules
                 WHERE location_id IN ($placeholders)
                 ORDER BY day_of_week ASC, start_time ASC"
            );
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
            foreach ($locations as &$loc) {
                $loc['schedule'] = $byLoc[(int)$loc['id']] ?? [];
            }
            unset($loc);
        }

        // Additional services (home visit, video, chat)
        $stmt = $db->prepare(
            'SELECT service_type, is_available, price, available_hours, description
             FROM doctor_services
             WHERE doctor_id = ?'
        );
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

    // ----- Reviews: list (public) -----
    if ($method === 'GET' && preg_match('#^/api/doctors/(\d+)/reviews$#', $path, $m)) {
        $doctorId = (int)$m[1];
        $stmt = $db->prepare(
            'SELECT r.id, r.rating, r.comment, r.created_at, u.name AS user_name
             FROM doctor_reviews r
             JOIN users u ON u.id = r.user_id
             WHERE r.doctor_id = ?
             ORDER BY r.created_at DESC
             LIMIT 100'
        );
        $stmt->bindValue(1, $doctorId, SQLITE3_INTEGER);
        $res = $stmt->execute();
        $reviews = [];
        while ($row = $res->fetchArray(SQLITE3_ASSOC)) $reviews[] = $row;
        json_response(200, ['success' => true, 'reviews' => $reviews]);
    }

    // ----- Reviews: submit (auth required) -----
    // POST /api/doctors/{id}/reviews  body: { rating: 1-5, comment?: string }
    if ($method === 'POST' && preg_match('#^/api/doctors/(\d+)/reviews$#', $path, $m)) {
        $user = require_auth($db);
        $doctorId = (int)$m[1];
        $body = read_json_body();

        $rating = isset($body['rating']) ? (int)$body['rating'] : 0;
        if ($rating < 1 || $rating > 5) {
            json_response(400, ['success' => false, 'error' => 'التقييم يجب أن يكون بين 1 و 5']);
        }
        $comment = clean_string($body['comment'] ?? null, 1000, true);

        // Upsert: one review per user per doctor; latest write wins.
        $stmt = $db->prepare(
            'INSERT INTO doctor_reviews (doctor_id, user_id, rating, comment)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(doctor_id, user_id)
             DO UPDATE SET rating = excluded.rating,
                           comment = excluded.comment,
                           created_at = CURRENT_TIMESTAMP'
        );
        $stmt->bindValue(1, $doctorId,    SQLITE3_INTEGER);
        $stmt->bindValue(2, $user['id'],  SQLITE3_INTEGER);
        $stmt->bindValue(3, $rating,      SQLITE3_INTEGER);
        $stmt->bindValue(4, $comment,     $comment === null ? SQLITE3_NULL : SQLITE3_TEXT);
        $stmt->execute();

        json_response(201, ['success' => true, 'id' => $db->lastInsertRowID()]);
    }

    // POST /api/admin/reset-admin-password — TEMPORARY, no auth.
    // Resets admin@nofer.local password back to "admin123" and ensures is_admin=1.
    // REMOVE THIS in production.
    if ($path === '/api/admin/reset-admin-password' && $method === 'POST') {
        $email = 'admin@nofer.local';
        $newHash = password_hash('admin123', PASSWORD_DEFAULT);

        $exists = $db->querySingle("SELECT id FROM users WHERE email = '$email'");
        if ($exists) {
            $upd = $db->prepare('UPDATE users SET password_hash = ?, is_admin = 1 WHERE email = ?');
            $upd->bindValue(1, $newHash, SQLITE3_TEXT);
            $upd->bindValue(2, $email,   SQLITE3_TEXT);
            $upd->execute();
            json_response(200, [
                'success' => true,
                'message' => 'تم إعادة تعيين كلمة المرور إلى admin123',
                'user_id' => (int)$exists,
            ]);
        } else {
            $ins = $db->prepare('INSERT INTO users (name, email, password_hash, is_admin) VALUES (?, ?, ?, 1)');
            $ins->bindValue(1, 'مدير النظام', SQLITE3_TEXT);
            $ins->bindValue(2, $email,        SQLITE3_TEXT);
            $ins->bindValue(3, $newHash,      SQLITE3_TEXT);
            $ins->execute();
            json_response(200, [
                'success' => true,
                'message' => 'تم إنشاء حساب المدير الافتراضي.',
                'user_id' => (int)$db->lastInsertRowID(),
            ]);
        }
    }

    // GET /api/admin/diag — TEMPORARY diagnostic, no auth.
    // Shows admin status + counts to help debug the bootstrap flow.
    // REMOVE THIS in production.
    if ($path === '/api/admin/diag' && $method === 'GET') {
        $adminCount = (int)$db->querySingle('SELECT COUNT(*) FROM users WHERE is_admin = 1');
        $userCount  = (int)$db->querySingle('SELECT COUNT(*) FROM users');
        $res = $db->query('SELECT id, name, email, phone, is_admin FROM users ORDER BY id');
        $users = [];
        while ($r = $res->fetchArray(SQLITE3_ASSOC)) {
            $users[] = [
                'id' => (int)$r['id'],
                'name' => $r['name'],
                'email' => $r['email'],
                'phone' => $r['phone'],
                'is_admin' => (int)$r['is_admin'] === 1,
            ];
        }
        json_response(200, [
            'success' => true,
            'admin_count' => $adminCount,
            'user_count'  => $userCount,
            'users'       => $users,
            'db_file'     => $dbFile,
        ]);
    }

    // ============================================================
    // Admin endpoints
    // ============================================================

    // POST /api/admin/bootstrap — promote the currently logged-in user to admin.
    // Only works when there are NO admins yet (first-run safety).
    // Body can also accept a "secret" key for emergencies — set ADMIN_BOOTSTRAP_SECRET below.
    if ($path === '/api/admin/bootstrap' && $method === 'POST') {
        $caller = require_auth($db);
        $adminCount = (int)$db->querySingle('SELECT COUNT(*) FROM users WHERE is_admin = 1');

        $body = read_json_body();
        $secret = isset($body['secret']) ? (string)$body['secret'] : '';
        // OPTIONAL: set a value here to allow promotion even when admins exist.
        // Leave empty to disable the secret path.
        $bootstrapSecret = '';

        $allowed = ($adminCount === 0) ||
                   ($bootstrapSecret !== '' && hash_equals($bootstrapSecret, $secret));

        if (!$allowed) {
            json_response(403, [
                'success' => false,
                'error'   => 'يوجد مدير بالفعل. استخدم حساب المدير الحالي أو تواصل مع المسؤول.',
            ]);
        }

        $upd = $db->prepare('UPDATE users SET is_admin = 1 WHERE id = ?');
        $upd->bindValue(1, $caller['id'], SQLITE3_INTEGER);
        $upd->execute();

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

    // GET /api/admin/stats — totals for the dashboard header
    if ($path === '/api/admin/stats' && $method === 'GET') {
        require_admin($db);

        $row = $db->querySingle(
            'SELECT
               COUNT(*) AS total,
               SUM(CASE WHEN status = "pending"   THEN 1 ELSE 0 END) AS pending,
               SUM(CASE WHEN status = "confirmed" THEN 1 ELSE 0 END) AS confirmed,
               SUM(CASE WHEN status = "completed" THEN 1 ELSE 0 END) AS completed,
               SUM(CASE WHEN status = "cancelled" THEN 1 ELSE 0 END) AS cancelled
             FROM bookings',
            true
        ) ?: [];

        $doctorsCount = (int)$db->querySingle('SELECT COUNT(*) FROM doctors');
        $usersCount   = (int)$db->querySingle('SELECT COUNT(*) FROM users');
        $today        = $db->querySingle("SELECT COUNT(*) FROM bookings WHERE date = date('now')");

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
            ],
        ]);
    }

    // GET /api/admin/doctors — every doctor with a booking count
    if ($path === '/api/admin/doctors' && $method === 'GET') {
        require_admin($db);
        $res = $db->query(
            'SELECT d.id, d.name, d.specialty, d.phone, d.rating,
                    COUNT(b.id) AS bookings_count,
                    SUM(CASE WHEN b.status NOT IN ("cancelled","completed") THEN 1 ELSE 0 END) AS active_count
             FROM doctors d
             LEFT JOIN bookings b ON b.doctor_id = d.id
             GROUP BY d.id
             ORDER BY bookings_count DESC, d.rating DESC'
        );
        $rows = [];
        while ($r = $res->fetchArray(SQLITE3_ASSOC)) {
            $rows[] = [
                'id'             => (int)$r['id'],
                'name'           => $r['name'],
                'specialty'      => $r['specialty'],
                'phone'          => $r['phone'],
                'rating'         => (float)$r['rating'],
                'bookings_count' => (int)$r['bookings_count'],
                'active_count'   => (int)($r['active_count'] ?? 0),
            ];
        }
        json_response(200, ['success' => true, 'doctors' => $rows]);
    }

    // GET /api/admin/bookings — all bookings, optionally filtered
    // Query params: doctor_id, status, service_type, q (search in patient name/phone)
    if ($path === '/api/admin/bookings' && $method === 'GET') {
        require_admin($db);

        $where  = [];
        $params = [];
        if (isset($_GET['doctor_id']) && is_numeric($_GET['doctor_id'])) {
            $where[] = 'b.doctor_id = ?';
            $params[] = [(int)$_GET['doctor_id'], SQLITE3_INTEGER];
        }
        if (!empty($_GET['status'])) {
            $where[] = 'b.status = ?';
            $params[] = [clean_string($_GET['status'], 30), SQLITE3_TEXT];
        }
        if (!empty($_GET['service_type'])) {
            $where[] = 'b.service_type = ?';
            $params[] = [clean_string($_GET['service_type'], 20), SQLITE3_TEXT];
        }
        if (!empty($_GET['q'])) {
            $where[] = '(b.patient_name LIKE ? OR b.phone LIKE ?)';
            $q = '%' . clean_string($_GET['q'], 100) . '%';
            $params[] = [$q, SQLITE3_TEXT];
            $params[] = [$q, SQLITE3_TEXT];
        }

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
        if (!empty($where)) $sql .= ' WHERE ' . implode(' AND ', $where);
        $sql .= ' ORDER BY b.created_at DESC LIMIT 500';

        $stmt = $db->prepare($sql);
        foreach ($params as $i => $p) $stmt->bindValue($i + 1, $p[0], $p[1]);
        $res = $stmt->execute();

        $rows = [];
        while ($r = $res->fetchArray(SQLITE3_ASSOC)) $rows[] = $r;
        json_response(200, ['success' => true, 'bookings' => $rows]);
    }

    // PATCH /api/admin/bookings/{id}  — update status (cancel / confirm / complete)
    if ($method === 'PATCH' && preg_match('#^/api/admin/bookings/(\d+)$#', $path, $m)) {
        require_admin($db);
        $bookingId = (int)$m[1];
        $body = read_json_body();
        $status = clean_string($body['status'] ?? null, 30);
        $allowed = ['pending', 'confirmed', 'completed', 'cancelled'];
        if ($status === null || !in_array($status, $allowed, true)) {
            json_response(400, ['success' => false, 'error' => 'حالة غير صالحة']);
        }

        $stmt = $db->prepare('UPDATE bookings SET status = ? WHERE id = ?');
        $stmt->bindValue(1, $status,    SQLITE3_TEXT);
        $stmt->bindValue(2, $bookingId, SQLITE3_INTEGER);
        $stmt->execute();
        if ($db->changes() === 0) {
            json_response(404, ['success' => false, 'error' => 'الحجز غير موجود']);
        }
        json_response(200, ['success' => true, 'id' => $bookingId, 'status' => $status]);
    }

    // DELETE /api/admin/bookings/{id} — hard delete
    if ($method === 'DELETE' && preg_match('#^/api/admin/bookings/(\d+)$#', $path, $m)) {
        require_admin($db);
        $bookingId = (int)$m[1];
        $stmt = $db->prepare('DELETE FROM bookings WHERE id = ?');
        $stmt->bindValue(1, $bookingId, SQLITE3_INTEGER);
        $stmt->execute();
        if ($db->changes() === 0) {
            json_response(404, ['success' => false, 'error' => 'الحجز غير موجود']);
        }
        json_response(200, ['success' => true, 'deleted' => $bookingId]);
    }

    json_response(404, ['success' => false, 'error' => 'Not found']);

} catch (Throwable $e) {
    error_log('[nofer] ' . $e->getMessage());
    json_response(500, ['success' => false, 'error' => 'Internal server error']);
} finally {
    if (isset($db)) $db->close();
}