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

// ============================================================
// Auth modals
// ============================================================
function openLoginModal() {
    document.getElementById('loginError').textContent = '';
    document.getElementById('loginForm').reset();
    document.getElementById('loginModal').style.display = 'flex';
    document.getElementById('registerModal').style.display = 'none';
    setTimeout(() => document.getElementById('loginIdentifier')?.focus(), 50);
}

function closeLoginModal() {
    document.getElementById('loginModal').style.display = 'none';
}

function openRegisterModal() {
    document.getElementById('registerError').textContent = '';
    document.getElementById('registerForm').reset();
    document.getElementById('registerModal').style.display = 'flex';
    document.getElementById('loginModal').style.display = 'none';
    setTimeout(() => document.getElementById('registerName')?.focus(), 50);
}

function closeRegisterModal() {
    document.getElementById('registerModal').style.display = 'none';
}

async function handleLogin(e) {
    e.preventDefault();
    const form = e.target;
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';
    const identifier = (form.identifier.value || '').trim();
    const password   = form.password.value || '';
    if (!identifier || !password) {
        errEl.textContent = 'الرجاء إدخال البريد/الهاتف وكلمة المرور.';
        return;
    }

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true; const btnLabel = btn.textContent; btn.textContent = '...جارٍ الدخول';
    try {
        const { ok, status, data } = await auth.login(identifier, password);
        if (ok && data.success) {
            closeLoginModal();
            updateAuthUI();
            // If the user was trying to book before logging in, resume that flow
            if (pendingBookingDoctorId !== null) {
                const id = pendingBookingDoctorId;
                pendingBookingDoctorId = null;
                openBookingModal(id);
            }
        } else if (status === 429) {
            errEl.textContent = 'محاولات كثيرة جدًا. حاول لاحقًا.';
        } else {
            errEl.textContent = data.error === 'Invalid credentials'
                ? 'بيانات الدخول غير صحيحة.'
                : (data.error || 'تعذر تسجيل الدخول.');
        }
    } catch (err) {
        console.error('Login error:', err);
        errEl.textContent = 'تعذر الاتصال بالخادم.';
    } finally {
        btn.disabled = false; btn.textContent = btnLabel;
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const form = e.target;
    const errEl = document.getElementById('registerError');
    errEl.textContent = '';
    const name     = (form.name.value || '').trim();
    const email    = (form.email.value || '').trim();
    const phone    = (form.phone.value || '').trim();
    const password = form.password.value || '';
    const confirm  = form.password_confirm.value || '';

    if (!name) { errEl.textContent = 'الرجاء إدخال الاسم.'; return; }
    if (!email && !phone) { errEl.textContent = 'الرجاء إدخال بريد إلكتروني أو رقم هاتف.'; return; }
    if (password.length < 8) { errEl.textContent = 'كلمة المرور يجب ألا تقل عن ٨ أحرف.'; return; }
    if (password !== confirm) { errEl.textContent = 'كلمتا المرور غير متطابقتين.'; return; }

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true; const btnLabel = btn.textContent; btn.textContent = '...جارٍ الإنشاء';
    try {
        const payload = { name, password };
        if (email) payload.email = email;
        if (phone) payload.phone = phone;
        const { ok, data } = await auth.register(payload);
        if (ok && data.success) {
            closeRegisterModal();
            updateAuthUI();
            if (pendingBookingDoctorId !== null) {
                const id = pendingBookingDoctorId;
                pendingBookingDoctorId = null;
                openBookingModal(id);
            }
        } else {
            const map = {
                'Email already registered': 'هذا البريد مسجل بالفعل.',
                'Phone already registered': 'هذا الهاتف مسجل بالفعل.',
                'Invalid email': 'البريد الإلكتروني غير صالح.',
                'Invalid phone': 'رقم الهاتف غير صالح.',
                'Invalid name': 'الاسم غير صالح.',
                'Password must be 8-128 characters': 'كلمة المرور يجب أن تكون بين ٨ و ١٢٨ حرفًا.'
            };
            errEl.textContent = map[data.error] || data.error || 'تعذر إنشاء الحساب.';
        }
    } catch (err) {
        console.error('Register error:', err);
        errEl.textContent = 'تعذر الاتصال بالخادم.';
    } finally {
        btn.disabled = false; btn.textContent = btnLabel;
    }
}

async function handleLogout() {
    await auth.logout();
    updateAuthUI();
}

// ----- Header auth area -----
function updateAuthUI() {
    const loggedOut = document.getElementById('authLoggedOut');
    const loggedIn  = document.getElementById('authLoggedIn');
    const userLabel = document.getElementById('authUserName');
    const myBookingsLink = document.getElementById('myBookingsLink');
    if (auth.isLoggedIn()) {
        loggedOut.style.display = 'none';
        loggedIn.style.display  = 'flex';
        userLabel.textContent = auth.user.name || '';
        if (myBookingsLink) myBookingsLink.style.display = '';
        // Show the admin dashboard link only for admin accounts.
        // Handles all possible types coming from the API/cache: true, 1, "1".
        const adminLink = document.getElementById('adminLink');
        if (adminLink) {
            const isAdmin = auth.user.is_admin === true
                         || auth.user.is_admin === 1
                         || auth.user.is_admin === '1';
            adminLink.style.display = isAdmin ? 'inline-flex' : 'none';
        }
        // Pre-fill the booking form once we know who's logged in
        const nameInput  = document.querySelector('#bookingForm input[name="patient_name"]');
        const phoneInput = document.querySelector('#bookingForm input[name="phone"]');
        if (nameInput && !nameInput.value)  nameInput.value  = auth.user.name || '';
        if (phoneInput && !phoneInput.value) phoneInput.value = auth.user.phone || '';
    } else {
        loggedOut.style.display = 'flex';
        loggedIn.style.display  = 'none';
        if (myBookingsLink) myBookingsLink.style.display = 'none';
        // Close the My Bookings modal if it was open
        if (typeof closeMyBookings === 'function') closeMyBookings();
    }
    // Reflect auth state in the review form if the doctor modal is open
    if (typeof updateReviewFormVisibility === 'function') updateReviewFormVisibility();
}

// ============================================================
// Specialties / Doctors / Clinics (mostly unchanged)
// ============================================================
function renderSpecialties() {
    const grid = document.querySelector('.specialties-grid');
    if (!grid) return;
    grid.innerHTML = clinicData.specialties.slice(0, 12).map(spec => `
        <div class="card specialty-mini" data-spec="${escapeHTML(spec)}">
            <div class="card-icon-small">${escapeHTML(clinicData.specialtyIcons[spec] || '⚕️')}</div>
            <h4>${escapeHTML(spec)}</h4>
        </div>
    `).join('');
    grid.querySelectorAll('.specialty-mini').forEach(el => {
        el.addEventListener('click', () => showTopDoctors(el.dataset.spec));
    });
}

function renderDoctors() {
    const grid = document.querySelector('.doctors-grid');
    if (!grid) return;
    if (filteredDoctors.length === 0) {
        grid.innerHTML = '<div class="no-results">لا توجد نتائج مطابقة.</div>';
        return;
    }
    grid.innerHTML = filteredDoctors.slice(0, 12).map(doctor => {
        const svc = generateFallbackServices(doctor);
        const badges = ['home_visit', 'video', 'chat']
            .filter(k => svc[k] && svc[k].is_available)
            .map(k => `<span class="svc-badge" title="${SERVICE_META[k].label}">${SERVICE_META[k].icon} ${SERVICE_META[k].short}</span>`)
            .join('');
        return `
        <div class="card doctor-card fade-in-up" data-action="view-doctor" data-id="${doctor.id}" role="button" tabindex="0" aria-label="عرض ملف ${escapeHTML(doctor.name)}">
            <div class="doctor-avatar">${doctor.img ? `<img src="${escapeHTML(doctor.img)}" alt="${escapeHTML(doctor.name)}" loading="lazy">` : '👨‍⚕️'}</div>
            <h3 class="doctor-name">${escapeHTML(doctor.name)}</h3>
            <p class="doctor-specialty">${escapeHTML(doctor.specialty)}</p>
            <div class="doctor-location">
                <span>${escapeHTML(doctor.location)}</span>
                <button class="map-btn" data-action="map-doctor" data-id="${doctor.id}" title="الخريطة">🗺️</button>
            </div>
            <div class="rating-stars">${renderStars(doctor.rating)}</div>
            ${badges ? `<div class="svc-badges">${badges}</div>` : ''}
            <button class="btn-book" data-action="book" data-id="${doctor.id}">احجز موعد</button>
        </div>`;
    }).join('');
}

function filterDoctors() {
    const query     = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
    const specialty = document.getElementById('specialtySelect')?.value || '';
    const area      = document.getElementById('areaSelect')?.value || '';
    filteredDoctors = clinicData.doctors.filter(d =>
        d.name.toLowerCase().includes(query) &&
        (specialty === '' || d.specialty === specialty) &&
        (area === '' || d.location.includes(area))
    );
    renderDoctors();
}

function showTopDoctors(specialty) {
    filteredDoctors = clinicData.doctors
        .filter(d => d.specialty === specialty)
        .sort((a, b) => b.rating - a.rating)
        .slice(0, 2);
    renderDoctors();
    document.getElementById('doctors')?.scrollIntoView({ behavior: 'smooth' });
}

async function loadClinics() {
    const grid = document.querySelector('#clinicsGrid');
    if (grid) grid.innerHTML = '<div class="no-results">جاري تحميل المستشفيات...</div>';
    try {
        const res = await fetch(`${API_BASE}/api/clinics`);
        const data = await res.json();
        if (data && data.success && Array.isArray(data.clinics)) {
            clinicFacilities.clinics = data.clinics;
            filteredClinics = [...data.clinics];
            renderClinics();
        } else {
            renderClinicsError('تعذر تحميل المستشفيات.');
        }
    } catch (err) {
        console.error('Clinics API error:', err);
        renderClinicsError('تعذر الاتصال بالخادم.');
    }
}

function renderClinicsError(msg) {
    const grid = document.querySelector('#clinicsGrid');
    if (grid) grid.innerHTML = `<div class="no-results">${escapeHTML(msg)}</div>`;
}

function renderClinics() {
    const grid = document.querySelector('#clinicsGrid');
    if (!grid) return;
    if (filteredClinics.length === 0) {
        grid.innerHTML = '<div class="no-results">لا توجد نتائج مطابقة.</div>';
        return;
    }
    grid.innerHTML = filteredClinics.map(clinic => `
        <div class="card clinic-card fade-in-up">
            <div class="clinic-avatar">🏥</div>
            <h3 class="clinic-name">${escapeHTML(clinic.name)}</h3>
            <div class="clinic-type-specialty">
                <span class="badge type-badge">${escapeHTML(clinic.type)}</span>
                <span class="badge specialty-badge">${escapeHTML(clinic.specialty)}</span>
            </div>
            <div class="doctor-location">
                <span>${escapeHTML(clinic.location)}</span>
                <button class="map-btn" data-action="clinic-details" data-id="${clinic.id}" title="التفاصيل">ℹ️</button>
            </div>
            <div class="rating-stars">${renderStars(clinic.rating)}</div>
            <button class="btn-book" data-action="clinic-details" data-id="${clinic.id}">عرض التفاصيل</button>
        </div>
    `).join('');
}

function filterClinics() {
    filteredClinics = clinicFacilities.filter();
    renderClinics();
}

// ============================================================
// Booking — requires login
// ============================================================
function openBookingModal(doctorId, context = null) {
    // Backward-compat: callers can pass a context { service, location, serviceData }
    // or just a location object directly (legacy).
    let service = 'clinic';
    let location = null;
    let serviceData = null;
    if (context && context.service) {
        service     = context.service;
        location    = context.location || null;
        serviceData = context.serviceData || null;
    } else if (context && context.address) {
        // legacy single-arg location
        location = context;
    }

    if (!auth.isLoggedIn()) {
        // Remember which doctor they wanted, then prompt login
        pendingBookingDoctorId = doctorId;
        openLoginModal();
        const errEl = document.getElementById('loginError');
        if (errEl) errEl.textContent = 'الرجاء تسجيل الدخول لإتمام الحجز.';
        return;
    }
    const doctor = clinicData.doctors.find(d => d.id == doctorId);
    if (!doctor) return;
    document.getElementById('modalDoctorName').textContent = doctor.name;
    document.getElementById('modalDoctorSpecialty').textContent = doctor.specialty;
    document.getElementById('modalDoctorId').value = doctor.id;
    document.getElementById('bookingModal').dataset.service = service;

    // Service badge
    const badge = document.getElementById('bookingServiceBadge');
    if (badge) {
        if (service !== 'clinic') {
            const meta = SERVICE_META[service] || { label: service, icon: '🩺' };
            badge.style.display = 'block';
            badge.innerHTML = `
                <span class="service-icon" aria-hidden="true">${meta.icon}</span>
                <span><strong>${meta.label}</strong></span>
                ${serviceData && serviceData.price != null
                    ? `<span class="badge-price">${serviceData.price} ج.م</span>` : ''}
                ${serviceData && serviceData.available_hours
                    ? `<div class="badge-hours">⏰ ${escapeHTML(serviceData.available_hours)}</div>` : ''}
            `;
        } else {
            badge.style.display = 'none';
            badge.innerHTML = '';
        }
    }

    // Selected-location summary (shown above the form fields, clinic visits only).
    const locSummary = document.getElementById('bookingLocationSummary');
    if (locSummary) {
        if (location && service === 'clinic') {
            locSummary.style.display = 'block';
            locSummary.innerHTML = `
                <span class="booking-loc-label">المكان:</span>
                <strong>${escapeHTML(location.clinic_name)}</strong>
                <span class="booking-loc-address">${escapeHTML(location.address)}</span>
                ${renderScheduleInline(location.schedule || [])}
            `;
        } else {
            locSummary.style.display = 'none';
            locSummary.innerHTML = '';
        }
    }

    // Pre-fill from user
    const nameInput  = document.querySelector('#bookingForm input[name="patient_name"]');
    const phoneInput = document.querySelector('#bookingForm input[name="phone"]');
    if (nameInput)  nameInput.value  = auth.user.name || '';
    if (phoneInput) phoneInput.value = auth.user.phone || '';

    const dateInput = document.querySelector('#bookingForm input[name="date"]');
    if (dateInput) dateInput.min = new Date().toISOString().slice(0, 10);

    // Stash location id (only used for clinic visits) and the chosen location hint.
    const notesInput = document.getElementById('bookNotes');
    if (notesInput) {
        notesInput.dataset.locationHint = (location && service === 'clinic')
            ? `${location.clinic_name} — ${location.address}`
            : '';
        notesInput.dataset.locationId = (location && service === 'clinic' && typeof location.id === 'number')
            ? String(location.id) : '';
    }

    // Date label adapts: "تاريخ الكشف" / "تاريخ الزيارة" / "تاريخ الاستشارة"
    const dateLabel = document.querySelector('label[for="bookDate"]');
    if (dateLabel) {
        dateLabel.textContent = service === 'home_visit' ? 'تاريخ الزيارة المنزلية'
            : (service === 'video' || service === 'chat') ? 'تاريخ الاستشارة'
            : 'التاريخ المطلوب';
    }
    // Submit button label
    const submitBtn = document.querySelector('#bookingForm button[type="submit"]');
    if (submitBtn) {
        submitBtn.textContent = service === 'clinic'
            ? 'احجز الموعد والدفع الآمن'
            : `احجز ${(SERVICE_META[service] || {}).label || ''} والدفع الآمن`;
    }

    document.getElementById('bookingModal').style.display = 'flex';
    // Reset the payment method extras (rebuilt when the user picks a method)
    const payEl = document.getElementById('bookPayment');
    if (payEl) payEl.value = '';
    updatePaymentFields('');
    // Make sure the modal opens scrolled to its top — not stuck below
    // a previously open dialog or scrolled page.
    document.getElementById('bookingModal').scrollTop = 0;
    const modalContent = document.querySelector('#bookingModal .modal-content');
    if (modalContent) modalContent.scrollTop = 0;
    document.body.style.overflow = 'hidden';
}

function renderScheduleInline(schedule) {
    if (!schedule.length) return '';
    // Just a compact line for the booking summary.
    const groups = new Map();
    schedule.forEach(s => {
        const key = `${s.start_time}-${s.end_time}`;
        if (!groups.has(key)) groups.set(key, { start: s.start_time, end: s.end_time, days: [] });
        groups.get(key).days.push(s.day_of_week);
    });
    return '<div class="booking-loc-schedule">' +
        Array.from(groups.values()).map(g => {
            const days = DAY_DISPLAY_ORDER.filter(d => g.days.includes(d)).map(d => DAY_NAMES_AR[d]).join('، ');
            return `<span>${days}: ${formatTime(g.start)} – ${formatTime(g.end)}</span>`;
        }).join('') +
        '</div>';
}

function openClinicModal(clinicId) {
    const clinic = clinicFacilities.clinics.find(c => c.id == clinicId);
    if (!clinic) return;
    document.getElementById('modalClinicName').textContent     = clinic.name;
    document.getElementById('modalClinicType').textContent     = clinic.type;
    document.getElementById('modalClinicSpecialty').textContent= clinic.specialty;
    document.getElementById('modalClinicId').value             = clinic.id;
    document.getElementById('modalClinicLocation').textContent = clinic.location;
    document.getElementById('modalClinicPhone').textContent    = clinic.phone || 'غير متوفر';
    document.getElementById('modalClinicCapacity').textContent = clinic.capacity ?? '-';
    document.getElementById('modalClinicRating').textContent   = renderStars(clinic.rating);

    const websiteLink = document.getElementById('modalClinicWebsite');
    if (clinic.website) {
        const url = /^https?:\/\//i.test(clinic.website) ? clinic.website : 'https://' + clinic.website;
        websiteLink.href = url;
        websiteLink.style.display = 'inline-block';
    } else {
        websiteLink.removeAttribute('href');
        websiteLink.style.display = 'none';
    }
    document.getElementById('clinicModal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('bookingModal').style.display = 'none';
    document.getElementById('bookingForm')?.reset();
    // Reset payment-method extra fields
    updatePaymentFields('');
    // Only release the page scroll if no other modal is still open
    const anyOtherOpen = ['doctorModal', 'clinicModal', 'loginModal', 'registerModal']
        .some(id => {
            const m = document.getElementById(id);
            return m && m.style.display === 'flex';
        });
    if (!anyOtherOpen) document.body.style.overflow = '';
}

function closeClinicModal() {
    document.getElementById('clinicModal').style.display = 'none';
}

// ----- Payment method: show the right input fields per method -----
const PAYMENT_FIELDS = {
    visa: [
        { name: 'card_number', label: 'رقم البطاقة',        type: 'text', placeholder: '0000 0000 0000 0000', maxlength: 19, pattern: '[0-9 ]{12,19}' },
        { name: 'card_name',   label: 'الاسم على البطاقة',  type: 'text', placeholder: 'كما هو مكتوب على البطاقة', maxlength: 100 },
        { name: 'card_expiry', label: 'تاريخ الانتهاء',     type: 'text', placeholder: 'MM/YY', maxlength: 5, pattern: '(0[1-9]|1[0-2])\\/[0-9]{2}' },
        { name: 'card_cvv',    label: 'CVV',                type: 'text', placeholder: '123', maxlength: 4, pattern: '[0-9]{3,4}', inputmode: 'numeric' }
    ],
    vodafone_cash: [
        { name: 'wallet_number', label: 'رقم محفظة فودافون كاش', type: 'tel', placeholder: '010XXXXXXXX', maxlength: 11, pattern: '01[0-9]{9}', inputmode: 'numeric' }
    ],
    fawry: [
        { name: 'fawry_phone', label: 'رقم الهاتف لإصدار كود فوري', type: 'tel', placeholder: '01XXXXXXXXX', maxlength: 11, pattern: '01[0-9]{9}', inputmode: 'numeric' }
    ],
    paypal: [
        { name: 'paypal_email', label: 'البريد المرتبط بحساب PayPal', type: 'email', placeholder: 'name@example.com', maxlength: 150 }
    ],
    cash: [] // No extra fields needed
};

function updatePaymentFields(method) {
    const host = document.getElementById('paymentExtraFields');
    if (!host) return;
    const fields = PAYMENT_FIELDS[method] || [];
    if (!fields.length) {
        host.innerHTML = '';
        return;
    }
    host.innerHTML = fields.map(f => `
        <div class="form-group">
            <label class="form-label" for="pay_${f.name}">${escapeHTML(f.label)}</label>
            <input id="pay_${f.name}"
                   name="${f.name}"
                   type="${f.type}"
                   class="form-input"
                   ${f.placeholder ? `placeholder="${escapeHTML(f.placeholder)}"` : ''}
                   ${f.maxlength ? `maxlength="${f.maxlength}"` : ''}
                   ${f.pattern ? `pattern="${f.pattern}"` : ''}
                   ${f.inputmode ? `inputmode="${f.inputmode}"` : ''}
                   required>
        </div>
    `).join('');
}

async function handleBooking(e) {
    e.preventDefault();
    if (!auth.isLoggedIn()) {
        notify('الرجاء تسجيل الدخول أولًا.', { type: 'warning' });
        openLoginModal();
        return;
    }
    const form = e.target;
    const formData = new FormData(form);
    const paymentMethod = formData.get('payment_method') || 'cash';

    // Validate the per-method extra fields and build a short reference string.
    let paymentRef = '';
    if (paymentMethod === 'visa') {
        const cardNumber = (formData.get('card_number') || '').replace(/\s+/g, '');
        const cardName   = (formData.get('card_name')   || '').trim();
        const cardExpiry = (formData.get('card_expiry') || '').trim();
        const cardCvv    = (formData.get('card_cvv')    || '').trim();
        if (!/^[0-9]{12,19}$/.test(cardNumber)) { notify('رقم البطاقة غير صحيح.', { type: 'warning' }); return; }
        if (!cardName) { notify('الاسم على البطاقة مطلوب.', { type: 'warning' }); return; }
        if (!/^(0[1-9]|1[0-2])\/[0-9]{2}$/.test(cardExpiry)) { notify('تاريخ انتهاء البطاقة بصيغة MM/YY.', { type: 'warning' }); return; }
        if (!/^[0-9]{3,4}$/.test(cardCvv)) { notify('رمز CVV غير صحيح.', { type: 'warning' }); return; }
        // Only keep the last four digits for reference. Never send full card data.
        paymentRef = `بطاقة منتهية بـ ${cardNumber.slice(-4)}`;
    } else if (paymentMethod === 'vodafone_cash') {
        const wallet = (formData.get('wallet_number') || '').trim();
        if (!/^01[0-9]{9}$/.test(wallet)) { notify('رقم محفظة فودافون كاش يجب أن يكون ١١ رقم ويبدأ بـ 01.', { type: 'warning' }); return; }
        paymentRef = `محفظة: ${wallet}`;
    } else if (paymentMethod === 'fawry') {
        const fawryPhone = (formData.get('fawry_phone') || '').trim();
        if (!/^01[0-9]{9}$/.test(fawryPhone)) { notify('رقم الهاتف لفوري يجب أن يكون ١١ رقم ويبدأ بـ 01.', { type: 'warning' }); return; }
        paymentRef = `فوري: ${fawryPhone}`;
    } else if (paymentMethod === 'paypal') {
        const ppEmail = (formData.get('paypal_email') || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ppEmail)) { notify('البريد الإلكتروني لـ PayPal غير صحيح.', { type: 'warning' }); return; }
        paymentRef = `PayPal: ${ppEmail}`;
    }

    // Prepend the chosen location to the notes (if any) so the doctor knows where.
    let notes = (formData.get('notes') || '').trim();
    const locationHint = document.getElementById('bookNotes')?.dataset.locationHint || '';
    if (locationHint) {
        notes = notes ? `[${locationHint}] ${notes}` : `[${locationHint}]`;
    }
    if (paymentRef) {
        notes = notes ? `${notes} | ${paymentRef}` : paymentRef;
    }
    const service = document.getElementById('bookingModal').dataset.service || 'clinic';
    const locIdStr = document.getElementById('bookNotes')?.dataset.locationId || '';
    const locationId = (service === 'clinic' && locIdStr && /^\d+$/.test(locIdStr))
        ? Number(locIdStr) : null;
    const booking = {
        doctor_id:      Number(document.getElementById('modalDoctorId').value),
        patient_name:   (formData.get('patient_name') || '').trim(),
        phone:          (formData.get('phone') || '').trim(),
        date:           formData.get('date'),
        payment_method: paymentMethod,
        notes:          notes,
        service_type:   service,
        location_id:    locationId
    };

    if (!booking.patient_name || !booking.phone || !booking.date) {
        notify('يرجى ملء جميع الحقول المطلوبة.', { type: 'warning' });
        return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '...جارٍ الإرسال'; }

    try {
        const res = await auth.fetch('/api/bookings', {
            method: 'POST',
            body: JSON.stringify(booking)
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
            // Build a complete booking object for the confirmation modal —
            // prefer what the server returned, but fall back to local fields
            // (doctor name, location hint) when something's missing.
            const fullBooking = enrichBookingForConfirmation(data.booking || { id: data.id }, booking);
            closeModal();
            showBookingConfirmation(fullBooking);
            // Persist a reminder for this booking. Default: enabled.
            scheduleBookingReminder(fullBooking);
            // Fire an immediate browser notification (and prompt for permission
            // the first time). This is the "alarm" half of the request.
            fireBookingConfirmationNotification(fullBooking);
        } else if (res.status === 401) {
            // Session expired between page load and submit
            notify('انتهت جلستك. الرجاء تسجيل الدخول مجددًا.', { type: 'warning' });
            pendingBookingDoctorId = booking.doctor_id;
            closeModal();
            openLoginModal();
        } else {
            notify('تعذر إتمام الحجز: ' + (data.error || 'خطأ غير معروف'), { type: 'error' });
        }
    } catch (err) {
        console.error('Booking error:', err);
        notify('تعذر الاتصال بالخادم. حاول لاحقًا.', { type: 'error' });
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'احجز الموعد والدفع الآمن'; }
    }
}

// ============================================================
// Doctor profile + reviews + locations
// ============================================================
let currentReviewRating = 0;
let currentDoctorLocations = []; // populated from API or fallback
let currentDoctorServices = {};  // { home_visit: {...}, video: {...}, chat: {...} }

const SERVICE_META = {
    home_visit: { label: 'كشف منزلي',     icon: '🏠', short: 'منزلي' },
    video:      { label: 'استشارة فيديو', icon: '📹', short: 'فيديو' },
    chat:       { label: 'استشارة شات',   icon: '💬', short: 'شات'   },
};

const DAY_NAMES_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
// Display order: Egyptian week (Saturday first)
const DAY_DISPLAY_ORDER = [6, 0, 1, 2, 3, 4, 5];

function openDoctorProfile(doctorId) {
    const doctor = clinicData.doctors.find(d => d.id == doctorId);
    if (!doctor) return;

    const modal = document.getElementById('doctorModal');
    modal.dataset.doctorId = doctor.id;

    // Header
    const avatar = document.getElementById('doctorProfileAvatar');
    avatar.innerHTML = doctor.img
        ? `<img src="${escapeHTML(doctor.img)}" alt="${escapeHTML(doctor.name)}">`
        : '👨‍⚕️';
    document.getElementById('doctorProfileName').textContent      = doctor.name;
    document.getElementById('doctorProfileSpecialty').textContent = doctor.specialty;
    const spec2 = document.getElementById('doctorProfileSpecialty2');
    if (spec2) spec2.textContent = doctor.specialty;
    document.getElementById('doctorProfileStars').textContent     = renderStars(doctor.rating);
    document.getElementById('doctorProfileRatingNum').textContent = Number(doctor.rating).toFixed(1);
    document.getElementById('doctorProfileReviewsCount').textContent = '';
    document.getElementById('doctorProfilePrice').textContent     = doctor.price ? doctor.price + ' ج.م' : 'يحدد عند الحجز';

    // Skeletons for sections that load async
    const locsEl = document.getElementById('doctorLocationsList');
    if (locsEl) locsEl.innerHTML = '<div class="reviews-empty">جاري تحميل أماكن التواجد...</div>';

    // Reset review form
    resetReviewForm();
    updateReviewFormVisibility();

    // Reviews list — show skeleton then load
    const list = document.getElementById('reviewsList');
    list.innerHTML = '<div class="reviews-empty">جاري تحميل التقييمات...</div>';

    modal.style.display = 'flex';
    // Lock background scroll while open
    document.body.style.overflow = 'hidden';

    loadDoctorProfile(doctor);
}

function closeDoctorProfile() {
    const modal = document.getElementById('doctorModal');
    modal.style.display = 'none';
    document.body.style.overflow = '';
    currentDoctorLocations = [];
}

async function loadDoctorProfile(doctor) {
    const list = document.getElementById('reviewsList');
    try {
        const res = await fetch(`${API_BASE}/api/doctors/${doctor.id}`);
        const data = await res.json();
        if (!data || !data.success) throw new Error('failed');

        // Update aggregate rating if the backend has reviews for this doctor
        if (data.review_count > 0) {
            document.getElementById('doctorProfileStars').textContent =
                renderStars(data.avg_rating);
            document.getElementById('doctorProfileRatingNum').textContent =
                Number(data.avg_rating).toFixed(1);
            document.getElementById('doctorProfileReviewsCount').textContent =
                ` (${data.review_count} تقييم)`;
        }

        // Locations: prefer backend data; if none (filler doctors), generate a sensible fallback.
        const locations = (data.locations && data.locations.length)
            ? data.locations
            : generateFallbackLocations(doctor);
        currentDoctorLocations = locations;
        renderDoctorLocations(locations);

        // Services: prefer backend data; fallback per-doctor for filler doctors.
        currentDoctorServices = (data.services && Object.keys(data.services).length)
            ? data.services
            : generateFallbackServices(doctor);
        renderDoctorServices(currentDoctorServices);

        renderReviews(data.reviews || []);
    } catch (_) {
        list.innerHTML = '<div class="reviews-empty">تعذر تحميل التقييمات الآن.</div>';
        // Still show fallback locations + services so the UI isn't empty.
        currentDoctorLocations = generateFallbackLocations(doctor);
        renderDoctorLocations(currentDoctorLocations);
        currentDoctorServices = generateFallbackServices(doctor);
        renderDoctorServices(currentDoctorServices);
    }
}

// For the 144 frontend-only "filler" doctors there's no backend row. Synthesize
// 2 locations + a deterministic weekly schedule from the doctor's id so the
// page still has something meaningful to show.
function generateFallbackLocations(doctor) {
    const primaryAddress = doctor.location || 'القاهرة';
    // Pick a secondary area different from the primary
    const altAreas = [
        'مدينة نصر - 12 شارع رمسيس',
        'المعادي - 23 كورنيش النيل',
        'المهندسين - 42 جامعة الدول العربية',
        'مصر الجديدة - 8 شارع الحجاز',
        'الدقي - 20 شارع النهضة',
        'التجمع الخامس - 90 شارع التسعين'
    ];
    const altIdx = doctor.id % altAreas.length;
    // Avoid duplicate
    let alt = altAreas[altIdx];
    if (primaryAddress.includes(alt.split(' - ')[0])) {
        alt = altAreas[(altIdx + 1) % altAreas.length];
    }

    // Deterministic schedules: pick 2-3 days per location based on id
    const idHash = Math.abs(doctor.id * 31);
    const scheduleA = pickSchedule(idHash,       ['15:00', '18:00'], 4); // afternoons
    const scheduleB = pickSchedule(idHash + 17,  ['18:00', '21:00'], 3); // evenings

    return [
        {
            id: `local-${doctor.id}-a`,
            clinic_name: `عيادة ${doctor.name.replace(/^د\.\s*/, 'د. ')}`,
            address: primaryAddress,
            phone: doctor.phone || '01000000000',
            price: doctor.price || 300,
            schedule: scheduleA,
        },
        {
            id: `local-${doctor.id}-b`,
            clinic_name: 'مركز طبي - فرع ثاني',
            address: alt,
            phone: '02-20000000',
            price: (doctor.price || 300) + 50,
            schedule: scheduleB,
        }
    ];
}

function pickSchedule(seed, [start, end], count) {
    // Pick `count` distinct days from 0..6 deterministically.
    const days = [];
    const used = new Set();
    let s = seed;
    while (days.length < count) {
        const d = s % 7;
        if (!used.has(d)) {
            used.add(d);
            days.push({ day_of_week: d, start_time: start, end_time: end });
        }
        s = (s * 13 + 7) % 1000;
    }
    return days;
}

// Synthesize a service mix for filler doctors. Deterministic per id so refreshes are stable.
function generateFallbackServices(doctor) {
    const id = doctor.id;
    const basePrice = doctor.price || 300;
    // Make availability deterministic but varied
    const homeAvail  = (id % 3) !== 0;             // ~66% offer home visits
    const videoAvail = (id % 5) !== 0;             // ~80% offer video
    const chatAvail  = ((id + 1) % 4) !== 0;       // ~75% offer chat

    return {
        home_visit: homeAvail ? {
            service_type: 'home_visit',
            is_available: true,
            price: basePrice + 250,
            available_hours: 'بميعاد مسبق',
            description: 'كشف منزلي داخل القاهرة الكبرى',
        } : { service_type: 'home_visit', is_available: false },

        video: videoAvail ? {
            service_type: 'video',
            is_available: true,
            price: Math.round(basePrice * 0.65),
            available_hours: 'يومياً 6م - 10م',
            description: 'استشارة فيديو عبر التطبيق',
        } : { service_type: 'video', is_available: false },

        chat: chatAvail ? {
            service_type: 'chat',
            is_available: true,
            price: Math.round(basePrice * 0.35),
            available_hours: '24/7',
            description: 'رد خلال 12 ساعة',
        } : { service_type: 'chat', is_available: false },
    };
}

function renderDoctorServices(services) {
    const el = document.getElementById('doctorServicesList');
    if (!el) return;
    const order = ['home_visit', 'video', 'chat'];
    const available = order.filter(k => services[k] && services[k].is_available);

    if (!available.length) {
        el.innerHTML = '<div class="reviews-empty">يتوفر الكشف بالعيادة فقط لهذا الطبيب.</div>';
        return;
    }

    el.innerHTML = available.map(key => {
        const s = services[key];
        const meta = SERVICE_META[key];
        return `
            <div class="service-card">
                <div class="service-card-head">
                    <span class="service-icon" aria-hidden="true">${meta.icon}</span>
                    <div class="service-card-titles">
                        <h4 class="service-name">${meta.label}</h4>
                        ${s.description ? `<p class="service-desc">${escapeHTML(s.description)}</p>` : ''}
                    </div>
                    ${s.price != null ? `<span class="service-price">${s.price} ج.م</span>` : ''}
                </div>
                ${s.available_hours ? `
                    <div class="service-hours">⏰ ${escapeHTML(s.available_hours)}</div>
                ` : ''}
                <button type="button" class="btn-book service-book-btn"
                        data-action="book-service" data-service="${key}">
                    احجز ${meta.label}
                </button>
            </div>
        `;
    }).join('');
}

function renderDoctorLocations(locations) {
    const el = document.getElementById('doctorLocationsList');
    if (!el) return;
    if (!locations.length) {
        el.innerHTML = '<div class="reviews-empty">لا توجد أماكن مسجلة لهذا الطبيب.</div>';
        return;
    }
    el.innerHTML = locations.map((loc, idx) => `
        <div class="location-card">
            <div class="location-card-head">
                <div>
                    <h4 class="location-name">${escapeHTML(loc.clinic_name)}</h4>
                    <p class="location-address">📍 ${escapeHTML(loc.address)}</p>
                </div>
                ${loc.price ? `<span class="location-price">${loc.price} ج.م</span>` : ''}
            </div>
            <div class="location-meta">
                ${loc.phone ? `<span>📞 ${escapeHTML(loc.phone)}</span>` : ''}
            </div>
            <div class="schedule-block">
                <span class="schedule-title">المواعيد:</span>
                ${renderSchedule(loc.schedule || [])}
            </div>
            <div class="location-actions">
                <button type="button" class="btn-book btn-book-secondary"
                        data-action="open-location-map" data-loc-idx="${idx}">🗺️ الخريطة</button>
                <button type="button" class="btn-book"
                        data-action="book-location" data-loc-idx="${idx}">احجز في هذا المكان</button>
            </div>
        </div>
    `).join('');
}

function renderSchedule(schedule) {
    if (!schedule.length) {
        return '<span class="schedule-empty">غير محدد</span>';
    }
    // Group by (start_time, end_time) so consecutive same-hour days show together.
    const groups = new Map();
    schedule.forEach(s => {
        const key = `${s.start_time}-${s.end_time}`;
        if (!groups.has(key)) groups.set(key, { start: s.start_time, end: s.end_time, days: [] });
        groups.get(key).days.push(s.day_of_week);
    });

    return Array.from(groups.values()).map(g => {
        const dayLabels = DAY_DISPLAY_ORDER
            .filter(d => g.days.includes(d))
            .map(d => DAY_NAMES_AR[d]);
        return `
            <div class="schedule-row">
                <span class="schedule-days">${dayLabels.join('، ')}</span>
                <span class="schedule-hours">${formatTime(g.start)} – ${formatTime(g.end)}</span>
            </div>
        `;
    }).join('');
}

function formatTime(hhmm) {
    // "15:00" → "3:00 م"
    if (!hhmm) return '';
    const [hStr, mStr] = hhmm.split(':');
    let h = parseInt(hStr, 10);
    const m = mStr || '00';
    const suffix = h >= 12 ? 'م' : 'ص';
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${m} ${suffix}`;
}

function renderReviews(reviews) {
    const list = document.getElementById('reviewsList');
    if (!reviews.length) {
        list.innerHTML = '<div class="reviews-empty">لا توجد تقييمات بعد. كن أول من يضيف رأيه!</div>';
        return;
    }
    list.innerHTML = reviews.map(r => `
        <div class="review-item">
            <div class="review-head">
                <span class="review-author">${escapeHTML(r.user_name || 'مستخدم')}</span>
                <span class="review-stars">${renderStars(r.rating)}</span>
            </div>
            ${r.comment ? `<p class="review-comment">${escapeHTML(r.comment)}</p>` : ''}
            <span class="review-date">${formatReviewDate(r.created_at)}</span>
        </div>
    `).join('');
}

function formatReviewDate(s) {
    if (!s) return '';
    // SQLite "YYYY-MM-DD HH:MM:SS" → display as is in Arabic locale
    try {
        const d = new Date(s.replace(' ', 'T') + 'Z');
        return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (_) {
        return s;
    }
}

// ----- Star input -----
function setupStarInput() {
    const wrap = document.getElementById('reviewStarInput');
    if (!wrap) return;
    const stars = wrap.querySelectorAll('.star-btn');

    const paint = (value) => {
        stars.forEach(s => {
            const v = Number(s.dataset.value);
            s.textContent = v <= value ? '★' : '☆';
            s.classList.toggle('star-active', v <= value);
        });
    };

    stars.forEach(s => {
        s.addEventListener('mouseenter', () => paint(Number(s.dataset.value)));
        s.addEventListener('focus',      () => paint(Number(s.dataset.value)));
        s.addEventListener('click', () => {
            currentReviewRating = Number(s.dataset.value);
            document.getElementById('reviewRating').value = currentReviewRating;
            paint(currentReviewRating);
        });
    });
    wrap.addEventListener('mouseleave', () => paint(currentReviewRating));
}

function resetReviewForm() {
    currentReviewRating = 0;
    document.getElementById('reviewRating').value = '0';
    document.getElementById('reviewComment').value = '';
    document.getElementById('reviewFormMsg').textContent = '';
    document.querySelectorAll('#reviewStarInput .star-btn').forEach(s => {
        s.textContent = '☆';
        s.classList.remove('star-active');
    });
}

function updateReviewFormVisibility() {
    const form = document.getElementById('reviewForm');
    if (!form) return;
    if (auth.isLoggedIn()) {
        form.classList.remove('review-form-locked');
        form.querySelector('.review-form-title').textContent = 'شاركنا تجربتك';
    } else {
        form.classList.add('review-form-locked');
        form.querySelector('.review-form-title').textContent = 'سجّل الدخول لكتابة تقييم';
    }
}

async function handleReviewSubmit(e) {
    e.preventDefault();
    const msgEl = document.getElementById('reviewFormMsg');
    msgEl.textContent = '';
    msgEl.classList.remove('msg-error', 'msg-ok');

    if (!auth.isLoggedIn()) {
        openLoginModal();
        const errEl = document.getElementById('loginError');
        if (errEl) errEl.textContent = 'الرجاء تسجيل الدخول لإضافة تقييم.';
        return;
    }

    const rating = Number(document.getElementById('reviewRating').value);
    if (!rating || rating < 1 || rating > 5) {
        msgEl.textContent = 'اختر تقييماً من 1 إلى 5 نجوم.';
        msgEl.classList.add('msg-error');
        return;
    }
    const comment = document.getElementById('reviewComment').value.trim();
    const doctorId = Number(document.getElementById('doctorModal').dataset.doctorId);

    try {
        const res = await auth.fetch(`/api/doctors/${doctorId}/reviews`, {
            method: 'POST',
            body: JSON.stringify({ rating, comment })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
            msgEl.textContent = data.error || 'تعذر إرسال التقييم.';
            msgEl.classList.add('msg-error');
            return;
        }
        msgEl.textContent = 'تم نشر تقييمك. شكراً لمشاركتك!';
        msgEl.classList.add('msg-ok');
        resetReviewForm();
        // Refresh whole profile (reviews + aggregate)
        const doctor = clinicData.doctors.find(d => d.id == doctorId);
        if (doctor) loadDoctorProfile(doctor);
    } catch (_) {
        msgEl.textContent = 'حدث خطأ بالشبكة. حاول مرة أخرى.';
        msgEl.classList.add('msg-error');
    }
}

// ----- Map links -----
function openMapForDoctor(doctorId) {
    const doctor = clinicData.doctors.find(d => d.id == doctorId);
    if (!doctor) return;
    const q = encodeURIComponent(doctor.location + '، القاهرة');
    window.open(`https://maps.google.com?q=${q}&z=17`, '_blank', 'noopener');
}

function openMapForClinic() {
    const clinicId = document.getElementById('modalClinicId').value;
    const clinic = clinicFacilities.clinics.find(c => c.id == clinicId);
    if (!clinic) return;
    const q = encodeURIComponent(clinic.location + '، القاهرة');
    window.open(`https://maps.google.com?q=${q}&z=17`, '_blank', 'noopener');
}

// ----- Theme -----
function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (_) {}
    const btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = next === 'dark' ? '🌙' : '☀️';
}

function loadTheme() {
    let saved = null;
    try { saved = localStorage.getItem('theme'); } catch (_) {}
    const theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = theme === 'dark' ? '🌙' : '☀️';
}

function toggleMobileMenu() {
    document.querySelector('.nav')?.classList.toggle('nav-open');
}

// ----- Event delegation -----
function setupCardDelegation() {
    document.body.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const id = Number(btn.dataset.id);
        switch (action) {
            case 'book':           openBookingModal(id); break;
            case 'map-doctor':     openMapForDoctor(id); break;
            case 'view-doctor':    openDoctorProfile(id); break;
            case 'book-location': {
                const idx = Number(btn.dataset.locIdx);
                const loc = currentDoctorLocations[idx];
                const docId = Number(document.getElementById('doctorModal').dataset.doctorId);
                openBookingModal(docId, { service: 'clinic', location: loc });
                break;
            }
            case 'book-service': {
                const key = btn.dataset.service;
                const docId = Number(document.getElementById('doctorModal').dataset.doctorId);
                const svc = currentDoctorServices[key];
                if (svc && svc.is_available) {
                    openBookingModal(docId, { service: key, serviceData: svc });
                }
                break;
            }
            case 'open-location-map': {
                const idx = Number(btn.dataset.locIdx);
                const loc = currentDoctorLocations[idx];
                if (loc) {
                    const q = encodeURIComponent(loc.address + '، القاهرة');
                    window.open(`https://maps.google.com?q=${q}&z=17`, '_blank', 'noopener');
                }
                break;
            }
            case 'clinic-details': openClinicModal(id);  break;
            case 'open-login':     openLoginModal();     break;
            case 'open-register':  openRegisterModal();  break;
            case 'switch-to-register': openRegisterModal(); break;
            case 'switch-to-login':    openLoginModal();    break;
            case 'logout':         handleLogout();       break;
        }
    });

    // Keyboard activation for clickable cards (Enter / Space).
    document.body.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const card = e.target.closest('.doctor-card[data-action="view-doctor"]');
        if (!card || e.target !== card) return;
        e.preventDefault();
        openDoctorProfile(Number(card.dataset.id));
    });
}

function setupEventListeners() {
    document.getElementById('searchBtn')?.addEventListener('click', filterDoctors);
    document.getElementById('searchInput')?.addEventListener('keyup', (e) => { if (e.key === 'Enter') filterDoctors(); });
    document.getElementById('specialtySelect')?.addEventListener('change', filterDoctors);
    document.getElementById('areaSelect')?.addEventListener('change', filterDoctors);

    document.getElementById('clinicsSearchBtn')?.addEventListener('click', filterClinics);
    document.getElementById('clinicsSearchInput')?.addEventListener('keyup', (e) => { if (e.key === 'Enter') filterClinics(); });
    document.getElementById('clinicsSpecialtySelect')?.addEventListener('change', filterClinics);
    document.getElementById('clinicsAreaSelect')?.addEventListener('change', filterClinics);

    document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);
    document.querySelector('.mobile-menu')?.addEventListener('click', toggleMobileMenu);

    document.getElementById('bookingForm')?.addEventListener('submit', handleBooking);
    document.getElementById('bookingModalClose')?.addEventListener('click', closeModal);
    document.getElementById('bookPayment')?.addEventListener('change', (e) => updatePaymentFields(e.target.value));
    document.getElementById('clinicModalClose')?.addEventListener('click', closeClinicModal);
    document.getElementById('clinicMapBtn')?.addEventListener('click', openMapForClinic);

    // Doctor profile modal wiring
    document.getElementById('doctorModalClose')?.addEventListener('click', closeDoctorProfile);
    document.getElementById('doctorProfileBookBtn')?.addEventListener('click', () => {
        const id = Number(document.getElementById('doctorModal').dataset.doctorId);
        if (id) openBookingModal(id);
    });
    document.getElementById('reviewForm')?.addEventListener('submit', handleReviewSubmit);
    setupStarInput();

    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
    document.getElementById('registerForm')?.addEventListener('submit', handleRegister);
    document.getElementById('loginModalClose')?.addEventListener('click', closeLoginModal);
    document.getElementById('registerModalClose')?.addEventListener('click', closeRegisterModal);

    document.addEventListener('click', (e) => {
        if (e.target.id === 'bookingModal')  closeModal();
        if (e.target.id === 'clinicModal')   closeClinicModal();
        if (e.target.id === 'doctorModal')   closeDoctorProfile();
        if (e.target.id === 'loginModal')    closeLoginModal();
        if (e.target.id === 'registerModal') closeRegisterModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        ['bookingModal', 'clinicModal', 'doctorModal', 'loginModal', 'registerModal'].forEach(id => {
            const m = document.getElementById(id);
            if (m && m.style.display === 'flex') m.style.display = 'none';
        });
    });

    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (!href || href === '#') return;
            const target = document.querySelector(href);
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });

    document.getElementById('ctaBookBtn')?.addEventListener('click', () => openBookingModal(1));
}

// ----- Init -----
document.addEventListener('DOMContentLoaded', async () => {
    loadTheme();
    renderSpecialties();
    renderDoctors();
    loadClinics();
    setupCardDelegation();
    setupEventListeners();

    // Hydrate auth state (validates stored token against server)
    if (auth.token) await auth.refreshFromServer();
    updateAuthUI();

    // Set up the booking-reminder system (browser notifications + scheduled alerts)
    initBookingReminders();
    setupMyBookingsView();
});

// Expose what script_doctors.js needs
window.clinicData = clinicData;
window.renderDoctors = renderDoctors;

// ============================================================
// Booking reminders + My Bookings page
//
// Architecture:
// - Whenever a booking is created, we store a "reminder" record in
//   localStorage keyed by user. Each record has the booking id, the
//   appointment date, the doctor name, the location, and which reminders
//   (24h before, 1h before) have already been fired.
// - A background interval (60s) checks all stored reminders and fires
//   browser notifications when one is due.
// - Reminders survive page reload because they live in localStorage.
// - The user can toggle reminders per-booking from the "حجوزاتي" page.
// - Cancelled bookings auto-clear their pending reminders.
// ============================================================

const REMINDER_STORAGE_KEY = 'nofer_reminders_v1';
const REMINDER_OFFSETS = [
    { ms: 24 * 60 * 60 * 1000, label: '٢٤ ساعة',  key: 't24h' },
    { ms:      60 * 60 * 1000, label: 'ساعة واحدة', key: 't1h'  },
];

function getStoredReminders() {
    try {
        const raw = localStorage.getItem(REMINDER_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (_) {
        return {};
    }
}
function saveStoredReminders(map) {
    try { localStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify(map)); } catch (_) {}
}
function reminderKey(bookingId) { return 'b_' + Number(bookingId); }

function scheduleBookingReminder(booking) {
    if (!booking || !booking.id || !booking.date) return;
    const map = getStoredReminders();
    const key = reminderKey(booking.id);
    if (!map[key]) {
        map[key] = {
            id:           Number(booking.id),
            date:         booking.date,
            doctor:       booking.doctor_name || ('طبيب #' + booking.doctor_id),
            specialty:    booking.specialty || '',
            locationName: booking.location_name || '',
            serviceType:  booking.service_type || 'clinic',
            enabled:      true,
            t24h:         false,
            t1h:          false,
            createdAt:    Date.now(),
        };
        saveStoredReminders(map);
    }
}

function cancelBookingReminder(bookingId) {
    const map = getStoredReminders();
    const key = reminderKey(bookingId);
    if (map[key]) {
        delete map[key];
        saveStoredReminders(map);
    }
}

function toggleBookingReminder(bookingId) {
    const map = getStoredReminders();
    const key = reminderKey(bookingId);
    if (map[key]) {
        map[key].enabled = !map[key].enabled;
        // If re-enabling, reset the "fired" flags so they can fire again if relevant
        if (map[key].enabled) { map[key].t24h = false; map[key].t1h = false; }
        saveStoredReminders(map);
        return map[key].enabled;
    }
    return false;
}

function isReminderEnabled(bookingId) {
    const r = getStoredReminders()[reminderKey(bookingId)];
    return !!(r && r.enabled);
}

// ----- Browser-Notification helpers -----
function notificationsSupported() {
    return typeof window !== 'undefined'
        && 'Notification' in window
        && typeof Notification.requestPermission === 'function';
}
function notificationsAllowed() {
    return notificationsSupported() && Notification.permission === 'granted';
}
async function requestNotificationPermissionOnce() {
    if (!notificationsSupported()) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied')  return false;
    try {
        const result = await Notification.requestPermission();
        return result === 'granted';
    } catch (_) {
        return false;
    }
}
function fireBrowserNotification(title, options) {
    if (!notificationsAllowed()) return null;
    try {
        const n = new Notification(title, Object.assign({
            lang:   'ar',
            dir:    'rtl',
            silent: false,
        }, options || {}));
        // Clicking the notification focuses the tab and jumps to My Bookings
        n.onclick = () => {
            try { window.focus(); } catch (_) {}
            if (options && options.data && options.data.bookingId) {
                openMyBookings();
            }
            n.close();
        };
        return n;
    } catch (err) {
        console.error('Notification error:', err);
        return null;
    }
}

// Called right after a successful booking. Always shows the in-site toast;
// also fires a browser notification when permission is granted, and asks
// for permission (gently) the first time.
async function fireBookingConfirmationNotification(booking) {
    const dateText = booking.date || 'موعد قريب';
    const docText  = booking.doctor_name || 'الطبيب';
    notify({
        type: 'success',
        title: 'تم تأكيد حجزك',
        message: `موعد مع ${docText} يوم ${dateText} • رقم الحجز #${booking.id}`,
        duration: 7000,
    });

    if (notificationsSupported() && Notification.permission === 'default') {
        // Wait a beat so the success modal is visible before the OS prompt
        setTimeout(async () => {
            const granted = await requestNotificationPermissionOnce();
            if (granted) {
                fireBrowserNotification('✅ تم تأكيد حجزك', {
                    body: `موعد مع ${docText} يوم ${dateText}`,
                    tag:  'nofer-booking-' + booking.id,
                    data: { bookingId: booking.id },
                });
            }
        }, 1200);
    } else if (notificationsAllowed()) {
        fireBrowserNotification('✅ تم تأكيد حجزك', {
            body: `موعد مع ${docText} يوم ${dateText}`,
            tag:  'nofer-booking-' + booking.id,
            data: { bookingId: booking.id },
        });
    }
}

// ----- Reminder loop (runs every minute) -----
function checkDueReminders() {
    if (!notificationsAllowed()) return;
    const map = getStoredReminders();
    const now = Date.now();
    let changed = false;
    Object.keys(map).forEach(key => {
        const r = map[key];
        if (!r || !r.enabled || !r.date) return;
        // Appointment time: we only have a date (YYYY-MM-DD), not a time —
        // anchor reminders to 09:00 local on that day, which is the typical
        // earliest visit hour. Better than firing at midnight.
        const apptTime = new Date(r.date + 'T09:00:00').getTime();
        if (isNaN(apptTime)) return;

        REMINDER_OFFSETS.forEach(off => {
            if (r[off.key]) return; // already fired
            const triggerAt = apptTime - off.ms;
            // Fire if now is past the trigger AND the appointment itself hasn't passed
            if (now >= triggerAt && now < apptTime) {
                fireBrowserNotification('🔔 تذكير بموعدك', {
                    body: `موعدك مع ${r.doctor} ${off.label === 'ساعة واحدة' ? 'بعد ساعة' : 'غداً'} (${r.date})${r.locationName ? ' • ' + r.locationName : ''}`,
                    tag:  'nofer-reminder-' + r.id + '-' + off.key,
                    data: { bookingId: r.id },
                    requireInteraction: off.key === 't1h',
                });
                r[off.key] = true;
                changed = true;
            }
        });
    });
    if (changed) saveStoredReminders(map);
}

function initBookingReminders() {
    // Start the periodic check. First fire ~5s after load so we catch any
    // appointments that came due while the page was being assembled.
    setTimeout(checkDueReminders, 5_000);
    setInterval(checkDueReminders, 60_000);

    // Wire up the confirmation modal controls
    const closeBtn = document.getElementById('confirmModalClose');
    const closeBtn2 = document.getElementById('confirmCloseBtn');
    const goBtn = document.getElementById('confirmGotoBookings');
    closeBtn?.addEventListener('click', closeBookingConfirmModal);
    closeBtn2?.addEventListener('click', closeBookingConfirmModal);
    goBtn?.addEventListener('click', () => {
        closeBookingConfirmModal();
        openMyBookings();
    });
    // Click outside to close
    const modal = document.getElementById('bookingConfirmModal');
    modal?.addEventListener('click', e => {
        if (e.target === modal) closeBookingConfirmModal();
    });
}

// ----- Confirmation modal -----
function closeBookingConfirmModal() {
    const m = document.getElementById('bookingConfirmModal');
    if (m) { m.style.display = 'none'; m.style.alignItems = ''; m.style.justifyContent = ''; }
    document.body.style.overflow = '';
}

function enrichBookingForConfirmation(serverBooking, localBooking) {
    // Server returns names from JOIN; if the join missed (e.g. seed doctor),
    // fall back to the local frontend data so the modal still shows useful info.
    const out = Object.assign({}, serverBooking);
    if (!out.doctor_name && localBooking?.doctor_id) {
        const d = (window.clinicData?.doctors || []).find(x => x.id === Number(localBooking.doctor_id));
        if (d) { out.doctor_name = d.name; out.specialty = d.specialty; }
    }
    if (!out.service_type && localBooking?.service_type) out.service_type = localBooking.service_type;
    if (!out.date && localBooking?.date)                 out.date = localBooking.date;
    if (!out.payment_method && localBooking?.payment_method) out.payment_method = localBooking.payment_method;
    return out;
}

function showBookingConfirmation(booking) {
    document.getElementById('confirmBookingId').textContent = '#' + booking.id;

    const serviceLabels = {
        clinic:     'كشف بالعيادة',
        home_visit: '🏠 كشف منزلي',
        video:      '📹 استشارة فيديو',
        chat:       '💬 استشارة شات',
    };
    const paymentLabels = {
        cash: 'نقدي', visa: 'بطاقة ائتمان', fawry: 'فوري',
        paypal: 'PayPal', vodafone_cash: 'فودافون كاش'
    };

    const rows = [];
    rows.push(detailRow('👨‍⚕️', 'الطبيب',  booking.doctor_name || '—',
                        booking.specialty ? `<span class="confirm-row-label">${escapeHTML(booking.specialty)}</span>` : ''));
    rows.push(detailRow('📅', 'التاريخ',  `<bdi>${escapeHTML(booking.date || '—')}</bdi>`));
    rows.push(detailRow('🩺', 'نوع الخدمة', serviceLabels[booking.service_type] || booking.service_type || 'كشف بالعيادة'));
    if (booking.location_name) {
        rows.push(detailRow('📍', 'المكان', escapeHTML(booking.location_name),
                            booking.location_address ? `<span class="confirm-row-label">${escapeHTML(booking.location_address)}</span>` : ''));
    }
    rows.push(detailRow('💳', 'وسيلة الدفع', paymentLabels[booking.payment_method] || booking.payment_method || '—'));
    if (booking.phone) {
        rows.push(detailRow('📞', 'رقم التواصل', `<bdi>${escapeHTML(booking.phone)}</bdi>`));
    }

    document.getElementById('confirmDetails').innerHTML = rows.join('');

    // Update reminder hint text if browser doesn't support notifications
    const reminderBox  = document.getElementById('confirmReminderBox');
    const reminderText = document.getElementById('confirmReminderText');
    if (!notificationsSupported()) {
        reminderBox.style.display = 'none';
    } else if (Notification.permission === 'denied') {
        reminderText.innerHTML = '<strong>الإشعارات معطّلة:</strong> فعّلها من إعدادات المتصفح لتلقّي تذكير قبل الموعد بـ ٢٤ ساعة وبساعة. التفاصيل ستظل متاحة في صفحة حجوزاتي.';
    } else if (Notification.permission === 'granted') {
        reminderText.innerHTML = '<strong>التذكير مفعّل:</strong> سيصلك إشعار من المتصفح قبل الموعد بـ ٢٤ ساعة وبساعة واحدة.';
    }

    const modal = document.getElementById('bookingConfirmModal');
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    document.body.style.overflow = 'hidden';
}

function detailRow(icon, label, value, extra) {
    return `
        <div class="confirm-row">
            <div class="confirm-row-icon">${icon}</div>
            <div>
                <div class="confirm-row-label">${label}</div>
                <div class="confirm-row-value">${value}${extra ? '<br>' + extra : ''}</div>
            </div>
        </div>
    `;
}

// ----- My Bookings page -----
let myBookingsCache = [];

function setupMyBookingsView() {
    // Open via nav link
    const link = document.getElementById('myBookingsLink');
    link?.addEventListener('click', e => {
        e.preventDefault();
        openMyBookings();
    });
    // Refresh button
    document.getElementById('myBookingsRefresh')?.addEventListener('click', loadMyBookings);
    // Close button
    document.getElementById('myBookingsClose')?.addEventListener('click', closeMyBookings);
    // Click on the backdrop (but not the content) closes the modal
    const modal = document.getElementById('myBookingsModal');
    modal?.addEventListener('click', e => {
        if (e.target === modal) closeMyBookings();
    });
    // Escape key closes the modal
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && modal && modal.style.display === 'flex') closeMyBookings();
    });
}

function openMyBookings() {
    if (!auth.isLoggedIn()) {
        notify('سجّل الدخول لعرض حجوزاتك', { type: 'warning' });
        openLoginModal();
        return;
    }
    const modal = document.getElementById('myBookingsModal');
    if (!modal) return;
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    document.body.style.overflow = 'hidden';
    loadMyBookings();
}

function closeMyBookings() {
    const modal = document.getElementById('myBookingsModal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.style.alignItems = '';
    modal.style.justifyContent = '';
    // Only release body scroll-lock if no other modal is still open
    const stillOpen = Array.from(document.querySelectorAll('.modal'))
        .some(m => m !== modal && m.style.display === 'flex');
    if (!stillOpen) document.body.style.overflow = '';
}

async function loadMyBookings() {
    if (!auth.isLoggedIn()) return;
    const wrap = document.getElementById('myBookingsContent');
    wrap.innerHTML = `
        <div class="bookings-empty">
            <div class="bookings-empty-icon">⏳</div>
            <p>جاري التحميل...</p>
        </div>
    `;
    try {
        const res = await auth.fetch('/api/bookings');
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'فشل تحميل الحجوزات');
        myBookingsCache = data.bookings || [];
        renderMyBookings();
    } catch (err) {
        console.error('My bookings error:', err);
        wrap.innerHTML = `
            <div class="bookings-empty">
                <div class="bookings-empty-icon">⚠️</div>
                <h3>تعذّر التحميل</h3>
                <p>${escapeHTML(err.message || 'حاول لاحقاً.')}</p>
            </div>
        `;
    }
}

function renderMyBookings() {
    const wrap = document.getElementById('myBookingsContent');
    const counter = document.getElementById('myBookingsCount');
    if (counter) counter.textContent = myBookingsCache.length;

    if (!myBookingsCache.length) {
        wrap.innerHTML = `
            <div class="bookings-empty">
                <div class="bookings-empty-icon">📭</div>
                <h3>لا توجد حجوزات بعد</h3>
                <p>اختر طبيباً واحجز موعدك من قائمة الأطباء.</p>
                <button type="button" class="btn-book" data-go-book>ابدأ الحجز</button>
            </div>
        `;
        wrap.querySelector('[data-go-book]')?.addEventListener('click', () => {
            document.getElementById('doctors')?.scrollIntoView({ behavior: 'smooth' });
        });
        return;
    }

    const STATUS_LABELS = {
        pending:   'قيد الانتظار',
        confirmed: 'مؤكد',
        completed: 'مكتمل',
        cancelled: 'ملغي',
    };
    const SERVICE_LABELS = {
        clinic:     '🏥 كشف بالعيادة',
        home_visit: '🏠 كشف منزلي',
        video:      '📹 استشارة فيديو',
        chat:       '💬 استشارة شات',
    };

    const cards = myBookingsCache.map(b => {
        const status = b.status || 'pending';
        const reminderOn = isReminderEnabled(b.id);
        const canCancel = (status === 'pending' || status === 'confirmed');
        const countdown = renderCountdown(b);
        const place = b.location_name
            ? `${escapeHTML(b.location_name)}${b.location_address ? ` — <span style="opacity:0.75;">${escapeHTML(b.location_address)}</span>` : ''}`
            : (b.service_type && b.service_type !== 'clinic' ? '<span style="opacity:0.7;">عن بُعد</span>' : '<span style="opacity:0.7;">عيادة غير محددة</span>');

        return `
            <div class="booking-card" data-id="${b.id}">
                <div class="booking-card-header">
                    <div>
                        <div class="booking-card-id">حجز #${b.id}</div>
                        <div class="booking-card-doctor">${escapeHTML(b.doctor_name || '—')}</div>
                        <div class="booking-card-specialty">${escapeHTML(b.specialty || '')}</div>
                    </div>
                    <span class="booking-status-pill booking-status-${status}">${STATUS_LABELS[status] || status}</span>
                </div>
                <div class="booking-card-body">
                    <div class="booking-line">
                        <span class="booking-line-icon">📅</span>
                        <span class="booking-line-value"><bdi>${escapeHTML(b.date || '—')}</bdi></span>
                    </div>
                    <div class="booking-line">
                        <span class="booking-line-icon">🩺</span>
                        <span class="booking-line-value">${SERVICE_LABELS[b.service_type] || 'كشف بالعيادة'}</span>
                    </div>
                    <div class="booking-line">
                        <span class="booking-line-icon">📍</span>
                        <span class="booking-line-value">${place}</span>
                    </div>
                    ${countdown}
                </div>
                <div class="booking-card-footer">
                    ${canCancel ? `
                        <button type="button" class="${reminderOn ? 'reminder-active' : ''}" data-action="reminder" data-id="${b.id}">
                            🔔 ${reminderOn ? 'التذكير مفعّل' : 'تفعيل التذكير'}
                        </button>
                        <button type="button" class="btn-danger-ghost" data-action="cancel" data-id="${b.id}">
                            ✕ إلغاء الحجز
                        </button>
                    ` : `
                        <button type="button" disabled>لا تتوفر إجراءات</button>
                    `}
                </div>
            </div>
        `;
    }).join('');

    wrap.innerHTML = `<div class="bookings-grid">${cards}</div>`;

    wrap.querySelectorAll('button[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = Number(btn.dataset.id);
            const act = btn.dataset.action;
            if (act === 'reminder') handleToggleReminder(id, btn);
            if (act === 'cancel')   handleCancelMyBooking(id, btn);
        });
    });
}

function renderCountdown(b) {
    if (!b.date) return '';
    if (b.status === 'cancelled' || b.status === 'completed') {
        const lbl = b.status === 'cancelled' ? 'الحجز ملغي' : 'الموعد مكتمل';
        return `<div class="booking-countdown passed">📌 ${lbl}</div>`;
    }
    const apptTime = new Date(b.date + 'T09:00:00').getTime();
    if (isNaN(apptTime)) return '';
    const diffMs = apptTime - Date.now();
    if (diffMs < 0) {
        return `<div class="booking-countdown passed">⏱ مرّ الموعد</div>`;
    }
    const days  = Math.floor(diffMs / 86_400_000);
    const hours = Math.floor((diffMs % 86_400_000) / 3_600_000);
    let text;
    if (days >= 1) text = `متبقّي <strong>${days}</strong> يوم${days === 1 ? '' : ''}`;
    else if (hours >= 1) text = `متبقّي <strong>${hours}</strong> ساعة`;
    else text = `أقل من ساعة على الموعد`;
    const cls = (days === 0) ? 'imminent' : '';
    return `<div class="booking-countdown ${cls}">⏱ ${text}</div>`;
}

async function handleToggleReminder(bookingId, btn) {
    // If notifications aren't even supported, explain and bail
    if (!notificationsSupported()) {
        notify('متصفحك لا يدعم إشعارات التذكير', { type: 'warning' });
        return;
    }
    // If denied at the browser level, can't do anything
    if (Notification.permission === 'denied') {
        notify('إشعارات المتصفح معطّلة. فعّلها من إعدادات الموقع.', { type: 'warning', duration: 6500 });
        return;
    }
    // Make sure the booking has a reminder record; if not, create one from cache
    const map = getStoredReminders();
    if (!map[reminderKey(bookingId)]) {
        const b = myBookingsCache.find(x => Number(x.id) === bookingId);
        if (b) scheduleBookingReminder(b);
    }

    const willEnable = !isReminderEnabled(bookingId);
    // If we're about to enable, ensure permission first
    if (willEnable && Notification.permission === 'default') {
        const granted = await requestNotificationPermissionOnce();
        if (!granted) {
            notify('لم يتم السماح بالإشعارات.', { type: 'warning' });
            return;
        }
    }
    const nowEnabled = toggleBookingReminder(bookingId);
    btn.classList.toggle('reminder-active', nowEnabled);
    btn.innerHTML = nowEnabled ? '🔔 التذكير مفعّل' : '🔔 تفعيل التذكير';
    notify(
        nowEnabled ? 'تم تفعيل التذكير لهذا الحجز' : 'تم إلغاء التذكير لهذا الحجز',
        { type: nowEnabled ? 'success' : 'info' }
    );
}

async function handleCancelMyBooking(bookingId, btn) {
    const b = myBookingsCache.find(x => Number(x.id) === bookingId);
    if (!b) return;
    if (!confirm(`هل تريد إلغاء حجزك مع ${b.doctor_name || 'الطبيب'} يوم ${b.date}؟`)) return;

    const card = btn.closest('.booking-card');
    card?.querySelectorAll('button').forEach(x => x.disabled = true);
    try {
        const res = await auth.fetch(`/api/bookings/${bookingId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'cancelled' }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || 'تعذّر الإلغاء');
        cancelBookingReminder(bookingId);
        notify('تم إلغاء الحجز', { type: 'success' });
        loadMyBookings();
    } catch (err) {
        notify(err.message || 'تعذّر الإلغاء', { type: 'error' });
        card?.querySelectorAll('button').forEach(x => x.disabled = false);
    }
}