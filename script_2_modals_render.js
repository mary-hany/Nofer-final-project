'use strict';
// ============================================================
// الجزء الثاني من الـ Frontend: المودالز + رأس الصفحة + عرض الأطباء والعيادات
// ============================================================
//
// الملف ده فيه كل اللي بيتشاف على الصفحة الرئيسية: فتح وغلق نوافذ
// تسجيل الدخول/التسجيل، عرض زر "تسجيل الدخول" أو اسم المستخدم في
// الـ navbar، و رندر التخصصات والأطباء والعيادات.
//
// محتويات الملف:
//
//   1) مودالز تسجيل الدخول والتسجيل (Auth Modals)
//      - openLoginModal()    / closeLoginModal()    : نافذة تسجيل الدخول.
//      - openRegisterModal() / closeRegisterModal() : نافذة إنشاء حساب جديد.
//      - handleLoginSubmit / handleRegisterSubmit : معالجة الـ form
//        بإرسالها لـ API_BASE/api/login أو /api/register عن طريق auth.fetch().
//      - بعد نجاح الدخول: بيتم استدعاء auth.setSession() لحفظ الـ token،
//        و updateAuthUI() علشان رأس الصفحة يتحدّث، ولو فيه pending booking
//        يكمّل الحجز اللي كان واقف.
//
//   2) شريط الـ Header (Auth UI)
//      - updateAuthUI() : بيغيّر اللي بيتعرض في الـ navbar حسب الحالة:
//          • مش مسجّل دخول → زر "تسجيل دخول" و "إنشاء حساب".
//          • مسجّل دخول    → اسم المستخدم + قائمة منسدلة فيها "حجوزاتي"
//                            و "تسجيل خروج" (و "لوحة التحكم" لو أدمن).
//
//   3) عرض التخصصات والأطباء (Specialties / Doctors)
//      - renderSpecialties() : ينشئ شبكة كروت التخصصات (قلب، عظام، إلخ).
//      - renderDoctors()     : يرسم كروت الأطباء المفلترين حالياً.
//      - filterDoctors()     : يطبّق فلتر البحث والتخصص والمنطقة.
//      - showTopDoctors(specialty) : عند الضغط على تخصص، يعرض أعلى الأطباء فيه.
//
//   4) عرض العيادات (Clinics)
//      - renderClinics() / filterClinics() : زي ما فوق لكن للعيادات.
//      - البيانات بتيجي من /api/clinics في الـ Backend (مش seed data).
//
// ملاحظة: الدوال في الجزء ده بتعتمد على متغيرات من الجزء الأول مثل
// clinicData, filteredDoctors, auth.fetch، notify ... إلخ، فلازم
// الجزء الأول يكون اتحمّل قبله.
// ============================================================

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
