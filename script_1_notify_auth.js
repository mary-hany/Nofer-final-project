// ============================================================
// الجزء الأول من الـ Frontend: الإشعارات + بيانات أولية + Auth Client
// ============================================================
//
// الملف ده بيتحمّل أوّل حاجة لأن باقي الأجزاء بتعتمد على المتغيرات
// والدوال المعرّفة هنا (notify, auth, clinicData, escapeHTML, إلخ).
//
// محتويات الملف:
//
//   1) نظام الإشعارات (Toast Notifications)
//      - بديل لـ alert() القبيح.
//      - بيظهر رسائل ملوّنة (success / error / warning / info) في الزاوية،
//        مع animation و إمكانية الإغلاق اليدوي.
//      - الاستخدام: notify('رسالة', { type: 'success' })
//                   notify.error('خطأ')، notify.success('تم')، إلخ.
//
//   2) البيانات الأولية الثابتة (Seed Data)
//      - clinicData: قائمة الأطباء الافتراضية اللي بتظهر في الصفحة الرئيسية
//        قبل ما الـ API يرد. لو الـ API نجح، البيانات الجاية منه بتحل محل دي.
//      - clinicFacilities: تفاصيل العيادات (إمكانيات، صور، إلخ).
//
//   3) State متغيرات الحالة العامة
//      - filteredDoctors / filteredClinics : النتايج الحالية بعد البحث/الفلترة.
//      - pendingBookingDoctorId : لو المستخدم ضغط احجز قبل ما يسجّل دخول،
//        بنحفظ ID الطبيب علشان نكمّل الحجز بعد ما يدخل.
//      - API_BASE : العنوان الأساسي للـ Backend (./backend.php).
//
//   4) دوال مساعدة (Utilities)
//      - escapeHTML(value) : لحماية الـ UI من XSS أثناء عرض نصوص من المستخدم.
//      - renderStars(rating) : ترجع نجوم ⭐ حسب التقييم.
//
//   5) Auth Client (الجزء الأهم)
//      - object اسمه `auth` بيدير كل اللي له علاقة بالتوكن وتسجيل الدخول:
//          • auth.token / auth.user             : البيانات المحفوظة في localStorage.
//          • auth.setSession({ token, user })   : يحفظ جلسة جديدة بعد لوجين/تسجيل.
//          • auth.clearSession()                : يمسح الجلسة (لوجاوت).
//          • auth.isLoggedIn()                  : true / false.
//          • auth.fetch(path, options)          : wrapper حول fetch() بيضيف
//            تلقائياً Authorization: Bearer <token> لكل الطلبات اللي محتاجة Auth.
//            لو السيرفر رد بـ 401 معناه التوكن انتهى → بيمسح الجلسة ويرجع للمستخدم.
//
// ملاحظة: 'use strict' مكتوبة هنا فقط، باقي الأجزاء كمان فيها 'use strict' لأن
// كل <script> tag بيكوّن scope منفصل في المتصفح.
// ============================================================

// Nofer frontend logic — auth-enabled.
// Adds: token storage, login/register/logout flows, auth-gated booking,
// header user state, Authorization headers on protected endpoints.

'use strict';

// ============================================================
// Toast notifications — replaces native alert()
// Usage:  notify('message')                            -> info
//         notify('message', { type: 'success' })
//         notify({ title: 'تم', message: '...', type: 'success', duration: 5000 })
//         notify.success(message, { title? })
//         notify.error(message), notify.warning(message), notify.info(message)
// ============================================================
const notify = (function () {
    const ICONS = {
        success: '✓',
        error:   '✕',
        warning: '!',
        info:    'i'
    };
    const TITLES_AR = {
        success: 'تم بنجاح',
        error:   'حدث خطأ',
        warning: 'تنبيه',
        info:    'معلومة'
    };

    let container = null;
    function getContainer() {
        if (container && document.body.contains(container)) return container;
        container = document.createElement('div');
        container.className = 'toast-container';
        container.setAttribute('role', 'region');
        container.setAttribute('aria-label', 'الإشعارات');
        document.body.appendChild(container);
        return container;
    }

    // Strip leading emoji markers used by the old alert() strings so we don't
    // double up with the toast's own icon. Examples: "⚠️ نص"  "✅ نص"  "❌ نص"
    function cleanMessage(text) {
        if (typeof text !== 'string') return text;
        return text.replace(/^\s*(?:⚠️|⚠|✅|❌|✓|✕|ℹ️|ℹ)\s*/u, '').trim();
    }

    // Infer a type from a raw alert() string if the caller didn't specify one.
    function inferType(text) {
        if (typeof text !== 'string') return 'info';
        if (/^\s*(?:✅|✓)/.test(text)) return 'success';
        if (/^\s*(?:❌|✕)/.test(text)) return 'error';
        if (/^\s*(?:⚠️|⚠)/.test(text)) return 'warning';
        return 'info';
    }

    function show(arg, opts) {
        // Normalize arguments
        let type, title, message, duration;
        if (arg && typeof arg === 'object' && !Array.isArray(arg)) {
            type     = arg.type     || 'info';
            title    = arg.title    != null ? arg.title : TITLES_AR[type] || TITLES_AR.info;
            message  = arg.message  != null ? arg.message : '';
            duration = arg.duration != null ? arg.duration : 4500;
        } else {
            const raw = String(arg == null ? '' : arg);
            type     = (opts && opts.type)     || inferType(raw);
            duration = (opts && opts.duration != null) ? opts.duration : 4500;
            title    = (opts && opts.title)    || TITLES_AR[type] || TITLES_AR.info;
            message  = cleanMessage(raw);
        }
        if (!['success', 'error', 'warning', 'info'].includes(type)) type = 'info';

        const root = getContainer();
        const toast = document.createElement('div');
        toast.className = `toast toast--${type}`;
        toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
        toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
        toast.style.setProperty('--toast-duration', duration + 'ms');

        const icon = document.createElement('div');
        icon.className = 'toast__icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = ICONS[type];

        const body = document.createElement('div');
        body.className = 'toast__body';

        const titleEl = document.createElement('div');
        titleEl.className = 'toast__title';
        titleEl.textContent = title;

        const msgEl = document.createElement('div');
        msgEl.className = 'toast__message';
        msgEl.textContent = message;

        body.appendChild(titleEl);
        if (message) body.appendChild(msgEl);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'toast__close';
        closeBtn.setAttribute('aria-label', 'إغلاق');
        closeBtn.textContent = '×';

        const progress = document.createElement('div');
        progress.className = 'toast__progress';
        progress.setAttribute('aria-hidden', 'true');

        toast.appendChild(icon);
        toast.appendChild(body);
        toast.appendChild(closeBtn);
        toast.appendChild(progress);

        // Newest on top
        root.insertBefore(toast, root.firstChild);

        // Slide in next frame
        requestAnimationFrame(() => {
            requestAnimationFrame(() => toast.classList.add('is-visible'));
        });

        // Auto-dismiss with pause-on-hover
        let timeoutId = null;
        let remaining = duration;
        let startTime = 0;

        function dismiss() {
            if (!toast.isConnected || toast.classList.contains('is-leaving')) return;
            if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
            toast.classList.remove('is-visible');
            toast.classList.add('is-leaving');
            const onEnd = () => {
                toast.removeEventListener('transitionend', onEnd);
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            };
            toast.addEventListener('transitionend', onEnd);
            // Safety fallback in case transitionend doesn't fire (reduced-motion etc.)
            setTimeout(onEnd, 600);
        }

        function startTimer() {
            if (duration <= 0) return;
            startTime = Date.now();
            timeoutId = setTimeout(dismiss, remaining);
        }
        function pauseTimer() {
            if (!timeoutId) return;
            clearTimeout(timeoutId);
            timeoutId = null;
            remaining -= Date.now() - startTime;
            toast.classList.add('is-paused');
        }
        function resumeTimer() {
            if (timeoutId || remaining <= 0) return;
            toast.classList.remove('is-paused');
            startTime = Date.now();
            timeoutId = setTimeout(dismiss, remaining);
        }

        closeBtn.addEventListener('click', (e) => { e.stopPropagation(); dismiss(); });
        toast.addEventListener('mouseenter', pauseTimer);
        toast.addEventListener('mouseleave', resumeTimer);
        toast.addEventListener('focusin', pauseTimer);
        toast.addEventListener('focusout', resumeTimer);

        startTimer();
        return { dismiss };
    }

    show.success = (msg, opts) => show(msg, Object.assign({ type: 'success' }, opts || {}));
    show.error   = (msg, opts) => show(msg, Object.assign({ type: 'error'   }, opts || {}));
    show.warning = (msg, opts) => show(msg, Object.assign({ type: 'warning' }, opts || {}));
    show.info    = (msg, opts) => show(msg, Object.assign({ type: 'info'    }, opts || {}));
    return show;
})();

// ----- Static seed data (frontend-only doctor list; clinics come from API) -----
const clinicData = {
    name: 'عيادة',
    doctors: [
        { id: 1, name: 'د. أحمد محمد',    specialty: 'جراحة العظام',     location: 'حلوان - ١٥ شارع مصطفى صفوت',         rating: 4.9 },
        { id: 2, name: 'د. فاطمة علي',    specialty: 'طب الأطفال',       location: 'المعادي - شارع اللاسلكي',             rating: 4.8 },
        { id: 3, name: 'د. محمد صالح',    specialty: 'الأمراض الداخلية', location: 'مصر الجديدة - النزهة الجديدة',         rating: 5.0 },
        { id: 4, name: 'د. سارة حسن',     specialty: 'الجلدية',          location: 'حدائق حلوان - شارع جمال عبدالناصر',   rating: 4.7 },
        { id: 5, name: 'د. خالد عبدالله', specialty: 'الأنف والأذن',     location: 'وسط البلد - شارع ٢٦ يوليو',           rating: 4.9 },
        { id: 6, name: 'د. نور السيد',    specialty: 'النساء والتوليد',  location: 'حلوان - شارع المحطة',                 rating: 4.8 }
    ],
    specialties: [
        'جراحة العظام', 'طب الأطفال', 'الأمراض الداخلية', 'الجلدية',
        'الأنف والأذن', 'النساء والتوليد', 'طب العيون', 'طب الأسنان',
        'المخ والأعصاب', 'أمراض القلب', 'الجهاز الهضمي', 'الكلى والبولية'
    ],
    specialtyIcons: {
        'جراحة العظام': '🦴', 'طب الأطفال': '👶', 'الأمراض الداخلية': '🩺',
        'الجلدية': '✨', 'الأنف والأذن': '👂', 'النساء والتوليد': '🤰',
        'طب العيون': '👁️', 'طب الأسنان': '🦷', 'المخ والأعصاب': '🧠',
        'أمراض القلب': '❤️', 'الجهاز الهضمي': '🍽️', 'الكلى والبولية': '💧'
    }
};

// ----- Generate filler doctors -----
(function generateExtraDoctors() {
    const addresses = [
        'مدينة نصر - ١٢ رمسيس، القاهرة ١١٧٥٧',
        'المعادي - ٢٣ كورنيش النيل، القاهرة ١١٤٣١',
        'التجمع الخامس - ٩٠ شارع التسعين، القاهرة ١١٨٣٥',
        'الزمالك - ٥ الشيخ يوسف، القاهرة ١١٢١١',
        'مصر الجديدة - ٨ الحجاز، القاهرة ١١٧٧١',
        'الدقي - ٢٠ النهضة، الجيزة ١٢٣١١',
        'المهندسين - ٤٢ جامعة الدول، الجيزة ١٢٦١١',
        'الهرم - ٧٥ شارع الهرم، الجيزة ١٢٥١١',
        'عين شمس - العباسية، القاهرة ١١٥٦٦',
        'شبرا - شارع شبرا ٣٠، القاهرة ١١٦٤٣'
    ];
    const firstNames = ['ياسر', 'هند', 'عمرو', 'رنا', 'سامي', 'هبة', 'كريم', 'نوال', 'طارق', 'لمى', 'باسم', 'جود', 'سيد', 'رانيا', 'فادي', 'داليا'];
    const lastNames  = ['الشربيني', 'السيد', 'عبدالرحمن', 'محمد', 'حسن', 'علي', 'إبراهيم', 'صلاح'];
    for (let i = 7; i <= 150; i++) {
        const fn = firstNames[(i * 7) % firstNames.length];
        const ln = lastNames[(i * 3) % lastNames.length];
        clinicData.doctors.push({
            id: i,
            name: `د. ${fn} ${ln}`,
            specialty: clinicData.specialties[(i - 1) % clinicData.specialties.length],
            location: addresses[(i - 1) % addresses.length],
            rating: Number((4.2 + ((i * 17) % 9) / 10).toFixed(1)),
            lat: 30.04 + ((i * 13) % 100 - 50) / 1000,
            lng: 31.24 + ((i * 11) % 100 - 50) / 1000
        });
    }
})();

// ----- State -----
const clinicFacilities = {
    clinics: [],
    filter() {
        const query     = (document.getElementById('clinicsSearchInput')?.value || '').toLowerCase().trim();
        const specialty = document.getElementById('clinicsSpecialtySelect')?.value || '';
        const area      = document.getElementById('clinicsAreaSelect')?.value || '';
        return this.clinics.filter(c =>
            c.name.toLowerCase().includes(query) &&
            (specialty === '' || c.specialty === specialty || c.type === specialty) &&
            (area === '' || c.location.includes(area))
        );
    }
};

let filteredDoctors = [...clinicData.doctors];
let filteredClinics = [];
let pendingBookingDoctorId = null; // remember the doctor while user is logging in

// ----- Utilities -----
function escapeHTML(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderStars(rating) {
    const r = Math.max(0, Math.min(5, Math.floor(Number(rating) || 0)));
    return '★'.repeat(r) + '☆'.repeat(5 - r);
}

const API_BASE = './backend.php';

// ============================================================
// Auth client
// ============================================================
const auth = {
    TOKEN_KEY: 'nofer_token',
    USER_KEY:  'nofer_user',

    get token() {
        try { return localStorage.getItem(this.TOKEN_KEY); } catch (_) { return null; }
    },
    set token(v) {
        try { v ? localStorage.setItem(this.TOKEN_KEY, v) : localStorage.removeItem(this.TOKEN_KEY); } catch (_) {}
    },
    get user() {
        try { const s = localStorage.getItem(this.USER_KEY); return s ? JSON.parse(s) : null; }
        catch (_) { return null; }
    },
    set user(u) {
        try { u ? localStorage.setItem(this.USER_KEY, JSON.stringify(u)) : localStorage.removeItem(this.USER_KEY); } catch (_) {}
    },

    isLoggedIn() { return !!this.token && !!this.user; },

    async fetch(path, options = {}) {
        const headers = Object.assign({}, options.headers || {});
        if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
        if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
        const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
        // If server says we're no longer authenticated, clear local state
        if (res.status === 401 && this.token) {
            this.token = null;
            this.user = null;
            updateAuthUI();
        }
        return res;
    },

    async register(payload) {
        const res = await fetch(`${API_BASE}/api/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
            this.token = data.token;
            this.user  = data.user;
        }
        return { ok: res.ok, status: res.status, data };
    },

    async login(identifier, password) {
        const res = await fetch(`${API_BASE}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier, password })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
            this.token = data.token;
            this.user  = data.user;
        }
        return { ok: res.ok, status: res.status, data };
    },

    async logout() {
        // Best-effort server-side revoke; clear locally regardless
        try { await this.fetch('/api/logout', { method: 'POST' }); } catch (_) {}
        this.token = null;
        this.user  = null;
    },

    /** Validate the stored token on page load; clears state if invalid. */
    async refreshFromServer() {
        if (!this.token) return false;
        try {
            const res = await this.fetch('/api/me');
            if (res.ok) {
                const data = await res.json();
                if (data && data.user) { this.user = data.user; return true; }
            }
        } catch (_) {}
        // Invalid / expired token
        this.token = null;
        this.user  = null;
        return false;
    }
};

