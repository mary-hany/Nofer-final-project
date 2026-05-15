-- Nofer database schema and seed data (SQLite)
-- Matches the runtime DB created by backend.php.
-- Load it via:  sqlite3 clinics.db < database.sql

PRAGMA foreign_keys = ON;

-- ---------- Core domain tables ----------
CREATE TABLE IF NOT EXISTS doctors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    specialty TEXT NOT NULL,
    location TEXT NOT NULL,
    phone TEXT,
    price INTEGER NOT NULL DEFAULT 250,
    rating REAL NOT NULL DEFAULT 4.5,
    lat REAL,
    lng REAL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clinics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    specialty TEXT NOT NULL,
    location TEXT NOT NULL,
    phone TEXT,
    capacity INTEGER NOT NULL DEFAULT 50,
    rating REAL NOT NULL DEFAULT 4.0,
    lat REAL,
    lng REAL,
    website TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------- Auth tables ----------
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Partial unique indexes: allow NULLs (user might register with only email OR only phone)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_token   ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    attempted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_ip_time ON login_attempts(ip, attempted_at);

-- ---------- Bookings ----------
CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    doctor_id INTEGER NOT NULL,
    patient_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    date TEXT NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'cash',
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    service_type TEXT NOT NULL DEFAULT 'clinic',
    location_id INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (doctor_id)   REFERENCES doctors(id),
    FOREIGN KEY (user_id)     REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (location_id) REFERENCES doctor_locations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_doctors_specialty ON doctors(specialty);
CREATE INDEX IF NOT EXISTS idx_doctors_location  ON doctors(location);
CREATE INDEX IF NOT EXISTS idx_clinics_specialty ON clinics(specialty);
CREATE INDEX IF NOT EXISTS idx_clinics_location  ON clinics(location);
CREATE INDEX IF NOT EXISTS idx_bookings_user     ON bookings(user_id);

-- ---------- Doctor reviews ----------
CREATE TABLE IF NOT EXISTS doctor_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_reviews_doctor ON doctor_reviews(doctor_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_unique ON doctor_reviews(doctor_id, user_id);

-- ---------- Doctor locations ----------
CREATE TABLE IF NOT EXISTS doctor_locations (
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
);
CREATE INDEX IF NOT EXISTS idx_doctor_locations_doctor ON doctor_locations(doctor_id);

-- ---------- Per-location weekly schedule ----------
-- day_of_week: 0=Sunday ... 6=Saturday (matches JS Date.getDay()).
-- start_time / end_time: "HH:MM" 24-hour.
CREATE TABLE IF NOT EXISTS location_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id INTEGER NOT NULL,
    day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    FOREIGN KEY (location_id) REFERENCES doctor_locations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_schedules_location ON location_schedules(location_id);

-- ---------- Doctor services (home visit, video, chat) ----------
CREATE TABLE IF NOT EXISTS doctor_services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id INTEGER NOT NULL,
    service_type TEXT NOT NULL CHECK(service_type IN ('home_visit','video','chat')),
    is_available INTEGER NOT NULL DEFAULT 1,
    price INTEGER,
    available_hours TEXT,
    description TEXT,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_doctor_services_doctor ON doctor_services(doctor_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_doctor_services_unique ON doctor_services(doctor_id, service_type);

DROP VIEW IF EXISTS v_top_clinics;
CREATE VIEW v_top_clinics AS
SELECT * FROM clinics ORDER BY rating DESC LIMIT 20;

-- ---------- Seed: clinics ----------
DELETE FROM clinics;
INSERT INTO clinics (name, type, specialty, location, phone, capacity, rating, lat, lng, website) VALUES
-- Existing original entries
('مستشفى الراعي الصالح',           'مستشفى',   'عام',         '١٥ شارع الهرم - الهرم - الجيزة ١٢٥١١',              '02-37608888', 250, 4.5, 29.9993, 31.1957, ''),
('مركز لوقا الطبي',                  'مركز طبي', 'متخصص',       '١٠ شارع رمسيس - العباسية - القاهرة ١١٥٦٦',          '02-26812345',  80, 4.6, 30.0750, 31.2686, 'luka-medical.com'),
('مستشفى شبرا العام',                'مستشفى',   'عام',         'شبرا - ٤٠ شارع الترعة - القاهرة ١١٦٤٣',             '02-24367890', 400, 4.1, 30.0861, 31.2434, ''),
('مستشفى الدمرداش التعليمي',          'مستشفى',   'عام',         'العباسية - شارع الدمرداش - القاهرة ١١٧٥٧',          '02-26055255', 800, 4.3, 30.0889, 31.2922, 'demerdash.edu.eg'),
('مستشفى سانت تريزا',                'مستشفى',   'عام',         'شبرا - ١٠ شارع سانت تريزا - القاهرة ١١٦٤٣',         '02-24320000', 150, 4.7, 30.0850, 31.2450, ''),
('مستشفى مارمرقس',                   'مستشفى',   'عام',         '١٠ شارع مارمرقس - مصر الجديدة - القاهرة ١١٧٧١',     '02-24123456', 200, 4.4, 30.0400, 31.3200, ''),
('مستشفى السلام الدولي',             'مستشفى',   'عام',         '٢٥ شارع كورنيش النيل - المعادي - القاهرة ١١٤٣١',    '02-25240077', 350, 4.6, 29.9656, 31.2542, 'alsalamhospital.com'),
('مستشفى الدفاع الجوي التخصصي',       'مستشفى',   'متخصص',       'مدينة نصر - شارع ستار الخير - القاهرة ١١٧٧١',       '02-24051234', 300, 4.2, 30.0600, 31.3100, ''),

-- Major private hospitals — central Cairo
('مستشفى دار الفؤاد',                 'مستشفى',   'متخصص',       'مدينة نصر - شارع مكرم عبيد - القاهرة',              '02-26909000', 350, 4.8, 30.0626, 31.3247, 'darelfouad.com'),
('مستشفى السعودي الألماني',           'مستشفى',   'عام',         'التجمع الخامس - شارع التسعين الجنوبي - القاهرة',     '02-26144444', 500, 4.7, 30.0148, 31.4275, 'sghgroup.com'),
('مستشفى كليوباترا',                  'مستشفى',   'عام',         'مصر الجديدة - شارع كليوباترا - القاهرة ١١٧٧١',       '02-22697799', 280, 4.5, 30.0978, 31.3296, 'cleopatrahospitals.com'),
('مستشفى النيل بدراوي',                'مستشفى',   'عام',         'كورنيش النيل - المعادي - القاهرة ١١٤٣١',             '02-25240212', 240, 4.6, 29.9521, 31.2487, 'nileurhospital.com'),
('مستشفى كليوباترا التجمع',            'مستشفى',   'عام',         'التجمع الخامس - شارع التسعين الجنوبي - القاهرة',      '02-26183100', 220, 4.5, 30.0192, 31.4341, 'cleopatrahospitals.com'),
('مستشفى الجلاء التعليمي',            'مستشفى',   'نساء وتوليد', 'الجلاء - وسط البلد - القاهرة ١١٥١١',                 '02-25770007', 450, 4.0, 30.0500, 31.2400, ''),
('المستشفى الإيطالي',                  'مستشفى',   'عام',         'شبرا - ميدان عبدالحميد لطفي - القاهرة ١١٦٤٣',        '02-24585577', 180, 4.3, 30.0750, 31.2400, ''),
('مستشفى أهل مصر للحروق',              'مستشفى',   'متخصص',       'القطامية - شارع ٩٠ - القاهرة الجديدة',                '02-25320005', 200, 4.7, 29.9978, 31.4567, 'ahlmasr.org'),

-- Specialty centers — heart, oncology, eye, fertility, etc.
('معهد القلب القومي',                  'مستشفى',   'قلب',         'إمبابة - الكورنيش - الجيزة ١٢٦٥١',                   '02-33371007', 600, 4.4, 30.0820, 31.2065, 'nhi.gov.eg'),
('معهد ناصر للأبحاث والعلاج',          'مستشفى',   'عام',         'شبرا - شارع الترعة البولاقية - القاهرة',             '02-24319111', 700, 4.2, 30.0890, 31.2470, ''),
('مستشفى ٥٧٣٥٧ لعلاج سرطان الأطفال',    'مستشفى',   'أورام',       'السيدة زينب - الكورنيش - القاهرة ١١٤١١',             '02-25351500', 320, 4.9, 30.0150, 31.2350, '57357.org'),
('المعهد القومي للأورام',              'مستشفى',   'أورام',       'فم الخليج - السيدة زينب - القاهرة',                  '02-23644720', 500, 4.3, 30.0167, 31.2389, 'nci.cu.edu.eg'),
('مستشفى الرمد التخصصي',               'مستشفى',   'عيون',        'روض الفرج - شارع روض الفرج - القاهرة ١١٦٢١',         '02-24582101', 220, 4.4, 30.0900, 31.2380, ''),
('مركز مغربي للعيون',                  'مركز طبي', 'عيون',        'المهندسين - شارع شهاب - الجيزة ١٢٦١١',               '02-37623040', 100, 4.7, 30.0606, 31.2058, 'magrabi.com.eg'),
('مركز نور الحياة لعلاج العقم',         'مركز طبي', 'نساء وتوليد', 'المهندسين - شارع جامعة الدول العربية - الجيزة',      '02-33361234',  60, 4.6, 30.0581, 31.2018, ''),
('مركز السلام لجراحة المخ والأعصاب',    'مركز طبي', 'متخصص',       'مدينة نصر - شارع مكرم عبيد - القاهرة',               '02-22745500',  80, 4.5, 30.0640, 31.3260, ''),

-- Other private hospitals
('مستشفى السلام الدولي - التجمع',      'مستشفى',   'عام',         'التجمع الخامس - الحي الأول - القاهرة الجديدة',        '02-26181111', 400, 4.6, 30.0220, 31.4180, 'alsalamhospital.com'),
('مستشفى الصفوة',                      'مستشفى',   'عام',         'حدائق الأهرام - شارع الجيش - الجيزة',                 '02-38380101', 150, 4.4, 29.9700, 31.1450, ''),
('مستشفى دار العيون',                  'مستشفى',   'عيون',        'حدائق الأهرام - شارع جاردينيا - الجيزة',              '02-38384700', 120, 4.5, 29.9720, 31.1480, ''),
('مستشفى الكرمة للنساء والتوليد',       'مستشفى',   'نساء وتوليد', 'التجمع الخامس - حي النرجس - القاهرة الجديدة',         '02-26171717', 100, 4.6, 30.0250, 31.4400, ''),
('مستشفى تبارك للأطفال',                'مستشفى',   'أطفال',       'التجمع الخامس - الحي الأول - القاهرة الجديدة',        '02-26181144', 130, 4.5, 30.0240, 31.4190, ''),
('مستشفى كوينز للنساء والتوليد',        'مستشفى',   'نساء وتوليد', 'حدائق الأهرام - البوابة الثالثة - الجيزة',            '02-38385000',  90, 4.4, 29.9710, 31.1460, ''),

-- Hospitals in Mohandessin, Dokki, Heliopolis, October City
('مستشفى المهندسين',                   'مستشفى',   'عام',         'المهندسين - شارع جامعة الدول العربية - الجيزة',       '02-33450707', 200, 4.3, 30.0590, 31.2030, ''),
('مستشفى الدقي التخصصي',                'مستشفى',   'متخصص',       'الدقي - شارع التحرير - الجيزة ١٢٣١١',                  '02-37606060', 180, 4.4, 30.0395, 31.2126, ''),
('مستشفى مصر الدولي',                  'مستشفى',   'عام',         'الدقي - شارع البطل أحمد عبدالعزيز - الجيزة',          '02-33358000', 220, 4.5, 30.0410, 31.2100, 'misrhospital.com'),
('مستشفى هليوبوليس',                   'مستشفى',   'عام',         'مصر الجديدة - شارع الميرغني - القاهرة ١١٧٧١',         '02-22906090', 200, 4.4, 30.0900, 31.3220, ''),
('مستشفى ٦ أكتوبر التخصصي',             'مستشفى',   'عام',         'مدينة ٦ أكتوبر - الحي الأول - الجيزة ١٢٥٧٣',          '02-38371234', 250, 4.5, 29.9285, 30.9188, ''),
('مستشفى الشيخ زايد التخصصي',          'مستشفى',   'متخصص',       'مدينة الشيخ زايد - الحي الأول - الجيزة',              '02-38500900', 300, 4.6, 30.0610, 30.9700, '');

-- ---------- Seed: doctors ----------
DELETE FROM doctors;
INSERT INTO doctors (id, name, specialty, location, phone, price, rating, lat, lng) VALUES
(1, 'د. أحمد السيد',     'أمراض باطنة',   'مدينة نصر - 20 رمسيس القاهرة',           '01023456789', 320, 4.8, 30.0626, 31.3047),
(2, 'د. فاطمة محمود',    'أمراض باطنة',   'المعادي - 15 كورنيش النيل القاهرة',      '01134567890', 280, 4.9, 29.9700, 31.2883),
(3, 'د. محمد علي',       'أمراض باطنة',   'التجمع الخامس - 25 شارع ست القاهرة',     '01245678901', 350, 4.7, 30.0148, 31.4075),
(4, 'د. ياسر الشربيني',  'جراحة العظام',  'مدينة نصر - ١٢ رمسيس القاهرة ١١٧٥٧',     '01001234567', 350, 4.9, 30.0626, 31.3047),
(5, 'د. هند السيد',      'طب الأطفال',    'المعادي - ٢٣ كورنيش النيل القاهرة ١٤٣١', '01123456789', 250, 4.8, 29.9700, 31.2883);

-- ---------- Seed: doctor_locations ----------
DELETE FROM doctor_locations;
INSERT INTO doctor_locations (id, doctor_id, clinic_name, address, phone, price, lat, lng, sort_order) VALUES
-- د. أحمد السيد (1) — مكانين
(1, 1, 'عيادة د. أحمد السيد',  'مدينة نصر - 20 شارع رمسيس - الدور الثالث',                  '01023456789', 320, 30.0626, 31.3047, 0),
(2, 1, 'مستشفى السلام الدولي', 'مصر الجديدة - 25 شارع عدلي',                                '02-24155555', 400, 30.0384, 31.3159, 1),

-- د. فاطمة محمود (2) — مكانين
(3, 2, 'مركز المعادي الطبي',    'المعادي - 15 كورنيش النيل - فيلا 22',                      '01134567890', 280, 29.9700, 31.2883, 0),
(4, 2, 'عيادة الزمالك',         'الزمالك - 5 شارع الشيخ يوسف - الدور الأول',                '02-27353535', 350, 30.0626, 31.2197, 1),

-- د. محمد علي (3) — تلات أماكن
(5, 3, 'عيادة التجمع الخامس',   'التجمع الخامس - 25 شارع التسعين الجنوبي',                  '01245678901', 350, 30.0148, 31.4075, 0),
(6, 3, 'مستشفى مارمرقس',         'مصر الجديدة - 10 شارع مارمرقس',                            '02-24123456', 400, 30.0400, 31.3200, 1),
(7, 3, 'مركز لوقا الطبي',        'العباسية - 10 شارع رمسيس',                                  '02-26812345', 300, 30.0750, 31.2686, 2),

-- د. ياسر الشربيني (4) — مكانين
(8, 4, 'عيادة د. ياسر للعظام',   'مدينة نصر - 12 شارع رمسيس - الدور الرابع',                  '01001234567', 350, 30.0626, 31.3047, 0),
(9, 4, 'مستشفى الدفاع الجوي',     'مدينة نصر - 100 شارع ستار الخير',                           '02-24051234', 450, 30.0600, 31.3100, 1),

-- د. هند السيد (5) — مكانين
(10, 5, 'عيادة د. هند للأطفال',  'المعادي - 23 كورنيش النيل - الدور الثاني',                  '01123456789', 250, 29.9700, 31.2883, 0),
(11, 5, 'مستشفى سانت تريزا',      'شبرا - 10 شارع سانت تريزا',                                  '02-24320000', 300, 30.0850, 31.2450, 1);

-- ---------- Seed: location_schedules ----------
-- day_of_week: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
DELETE FROM location_schedules;
INSERT INTO location_schedules (location_id, day_of_week, start_time, end_time) VALUES
-- Location 1 (د. أحمد - مدينة نصر): Sat/Mon/Wed 15:00-19:00
(1, 6, '15:00', '19:00'),
(1, 1, '15:00', '19:00'),
(1, 3, '15:00', '19:00'),
-- Location 2 (د. أحمد - مصر الجديدة): Sun/Tue 18:00-21:00
(2, 0, '18:00', '21:00'),
(2, 2, '18:00', '21:00'),

-- Location 3 (د. فاطمة - المعادي): Sat-Wed 10:00-13:00
(3, 6, '10:00', '13:00'),
(3, 0, '10:00', '13:00'),
(3, 1, '10:00', '13:00'),
(3, 2, '10:00', '13:00'),
(3, 3, '10:00', '13:00'),
-- Location 4 (د. فاطمة - الزمالك): Sun/Tue/Thu 17:00-20:00
(4, 0, '17:00', '20:00'),
(4, 2, '17:00', '20:00'),
(4, 4, '17:00', '20:00'),

-- Location 5 (د. محمد - التجمع): Sat/Mon 16:00-20:00
(5, 6, '16:00', '20:00'),
(5, 1, '16:00', '20:00'),
-- Location 6 (د. محمد - مصر الجديدة): Sun/Wed 18:00-22:00
(6, 0, '18:00', '22:00'),
(6, 3, '18:00', '22:00'),
-- Location 7 (د. محمد - العباسية): Tue/Thu 14:00-17:00
(7, 2, '14:00', '17:00'),
(7, 4, '14:00', '17:00'),

-- Location 8 (د. ياسر - مدينة نصر): Sat/Sun/Mon/Tue/Wed 17:00-21:00
(8, 6, '17:00', '21:00'),
(8, 0, '17:00', '21:00'),
(8, 1, '17:00', '21:00'),
(8, 2, '17:00', '21:00'),
(8, 3, '17:00', '21:00'),
-- Location 9 (د. ياسر - الدفاع الجوي): Thu 10:00-14:00
(9, 4, '10:00', '14:00'),

-- Location 10 (د. هند - المعادي): Sat/Sun/Mon/Wed 11:00-14:00
(10, 6, '11:00', '14:00'),
(10, 0, '11:00', '14:00'),
(10, 1, '11:00', '14:00'),
(10, 3, '11:00', '14:00'),
-- Location 11 (د. هند - شبرا): Tue/Thu 16:00-19:00
(11, 2, '16:00', '19:00'),
(11, 4, '16:00', '19:00');

-- ---------- Seed: doctor_services ----------
DELETE FROM doctor_services;
INSERT INTO doctor_services (doctor_id, service_type, is_available, price, available_hours, description) VALUES
-- د. أحمد السيد (1): كشف منزلي + فيديو، مفيش شات
(1, 'home_visit', 1, 600, 'الجمعة فقط 10ص - 4م',   'كشف منزلي داخل القاهرة الكبرى'),
(1, 'video',      1, 200, 'يومياً 8م - 11م',         'استشارة فيديو 20 دقيقة'),
(1, 'chat',       0, NULL, NULL, NULL),

-- د. فاطمة محمود (2): الثلاثة كلها
(2, 'home_visit', 1, 550, 'بميعاد مسبق',             'كشف منزلي - المعادي و المناطق المجاورة'),
(2, 'video',      1, 180, 'يومياً 7م - 10م',         'استشارة فيديو 15 دقيقة'),
(2, 'chat',       1, 100, '24/7',                    'رد خلال 6 ساعات'),

-- د. محمد علي (3): فيديو + شات بس
(3, 'home_visit', 0, NULL, NULL, NULL),
(3, 'video',      1, 250, 'الأحد - الخميس 6م - 9م',  'استشارة فيديو 30 دقيقة'),
(3, 'chat',       1, 120, '24/7',                    'رد خلال 12 ساعة'),

-- د. ياسر الشربيني (4): كشف منزلي بس (لأن جراحة عظام)
(4, 'home_visit', 1, 800, 'الجمعة و السبت',          'كشف منزلي و متابعة بعد العمليات'),
(4, 'video',      0, NULL, NULL, NULL),
(4, 'chat',       0, NULL, NULL, NULL),

-- د. هند السيد (5): فيديو + شات (طب أطفال - مناسب جداً للأونلاين)
(5, 'home_visit', 1, 450, 'حسب الاتفاق',             'كشف منزلي للأطفال - المعادي'),
(5, 'video',      1, 150, 'يومياً 10ص - 2م و 6م - 9م','استشارة فيديو 20 دقيقة'),
(5, 'chat',       1,  80, '24/7',                    'رد سريع خلال ساعتين');

-- bookings deliberately not seeded — they're now tied to real users.