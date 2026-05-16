'use strict';
// ============================================================
// الجزء الثالث من الـ Frontend: الحجز + ملف الطبيب + التقييمات
// ============================================================
//
// الملف ده هو أكبر جزء وأهمه — فيه كل اللي بيحصل لما المستخدم يضغط
// على طبيب لحد ما يكمّل الحجز ويسيب تقييم.
//
// محتويات الملف:
//
//   1) مودال الحجز (Booking Modal)
//      - openBookingModal(doctorId, context) : يفتح نافذة الحجز.
//          • لو المستخدم مش مسجّل دخول → بيخزّن pendingBookingDoctorId
//            ويفتح مودال الدخول بدل الحجز.
//          • context ممكن يكون عيادة معيّنة، أو زيارة منزلية، أو فيديو، أو شات.
//      - renderScheduleInline(schedule) : يعرض الجدول داخل المودال.
//      - openClinicModal(clinicId) / closeClinicModal() : لتفاصيل عيادة.
//      - closeModal() : إغلاق عام لأي مودال مفتوح.
//
//   2) حقول طرق الدفع (Payment Fields)
//      - PAYMENT_FIELDS : قاموس بيحدّد إيه الحقول المطلوبة لكل طريقة دفع
//        (visa, fawry, paypal, vodafone_cash, cash).
//      - updatePaymentFields(method) : لما المستخدم يغيّر طريقة الدفع،
//        الحقول المعروضة بتتغيّر تلقائياً (مثلاً visa → رقم البطاقة + CVV،
//        فودافون كاش → رقم الموبايل، كاش → مفيش حقول).
//      - validatePaymentDetails() : تحقّق من البيانات قبل الإرسال
//        (Luhn check لرقم الفيزا، CVV، تاريخ الانتهاء، إلخ).
//      - submitBooking() : يرسل POST /api/bookings عن طريق auth.fetch().
//
//   3) ملف الطبيب الكامل (Doctor Profile)
//      - openDoctorProfile(doctorId) : يفتح مودال كبير فيه:
//          • معلومات الطبيب الأساسية وصورته.
//          • متوسط التقييم وعدد التقييمات.
//          • الخدمات المتاحة (كشف بالعيادة، زيارة منزلية، فيديو، شات)
//            مع الأسعار والمواعيد.
//          • مواقع العيادات (تطلع من API لو متاحة، أو generateFallbackLocations).
//          • جدول العمل الأسبوعي (الأحد → السبت).
//          • قسم التقييمات (قراءة + كتابة تقييم جديد).
//      - closeDoctorProfile() : غلق المودال وتنضيف الحالة.
//      - generateFallbackLocations / generateFallbackServices :
//        بيانات اصطناعية (deterministic seed) لو الـ Backend مرجّعش
//        خدمات معيّنة.
//
//   4) التقييمات (Reviews)
//      - currentReviewRating : نجوم اللي اختارهم المستخدم حالياً.
//      - دوال paint() / mouseenter / click على النجوم للتفاعل.
//      - submitReview() : يرسل POST /api/doctors/{id}/reviews.
//      - renderDoctorReviews() : يرسم قائمة التقييمات داخل المودال.
//      - updateReviewFormVisibility() : لو غير مسجّل دخول بيخبّي نموذج
//        كتابة تقييم ويعرض زر "سجّل دخول علشان تقيّم".
//
//   5) تصدير للـ window
//      - في الآخر بيتم تصدير clinicData و renderDoctors على window
//        علشان script_doctors.js (ملف صغير منفصل) يقدر يستخدمهم.
//
// ملاحظة: كل الدوال هنا بتفترض إن الجزء الأول والثاني اتحمّلوا قبلها
// (notify, auth, escapeHTML, renderStars، clinicData، إلخ).
// ============================================================

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
