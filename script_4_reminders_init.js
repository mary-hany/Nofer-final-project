'use strict';
// ============================================================
// الجزء الرابع من الـ Frontend: التذكيرات + صفحة "حجوزاتي" + تشغيل التطبيق
// ============================================================
//
// الملف ده هو آخر جزء بيتحمّل، وفيه:
//   • نظام تذكيرات الحجوزات (Browser Notifications).
//   • صفحة "حجوزاتي" اللي بيشوف فيها المستخدم حجوزاته السابقة والقادمة.
//   • الكود اللي بيشتغل عند فتح الصفحة (DOMContentLoaded) — وده اللي بيربط
//     كل الأزرار وبيبتدي تحميل البيانات من الـ Backend.
//
// محتويات الملف:
//
//   1) نظام التذكيرات (Reminders System)
//      • فكرة العمل:
//          - لما المستخدم يحجز موعد، بنخزّن "reminder record" في localStorage.
//          - كل record فيه: id الحجز، تاريخ الموعد، اسم الطبيب، المكان،
//            وأيّ من التذكيرين اتبعت (قبل 24 ساعة، قبل ساعة).
//          - في الخلفية فيه setInterval كل 60 ثانية بيفحص الـ records
//            ولو لقى تذكير حان وقته بيطلق Notification في المتصفح.
//          - التذكيرات بتفضل موجودة حتى لو الصفحة اتقفلت وفتحت تاني
//            (لأنها متخزّنة في localStorage).
//          - لو المستخدم ألغى الحجز، التذكيرات بتتمسح تلقائياً.
//
//      • الثوابت الأساسية:
//          - REMINDER_STORAGE_KEY : مفتاح التخزين في localStorage.
//          - REMINDER_OFFSETS     : قائمة فيها التذكيرين (24 ساعة، ساعة).
//
//      • الدوال:
//          - getStoredReminders / saveReminders : قراءة/كتابة localStorage.
//          - scheduleBookingReminder(booking)   : يضيف تذكير لحجز جديد.
//          - cancelBookingReminder(bookingId)   : يمسح تذكير حجز ملغي.
//          - isReminderEnabled(bookingId)       : هل التذكير شغّال؟
//          - toggleBookingReminder(bookingId)   : Toggle من زر في صفحة حجوزاتي.
//          - requestNotificationPermissionOnce(): يطلب صلاحية الإشعارات مرة واحدة.
//          - checkReminders()                    : دالة الفحص اللي بتشتغل كل 60 ثانية.
//
//   2) صفحة "حجوزاتي" (My Bookings Page)
//      - loadMyBookings()      : بيجيب الحجوزات بتاعة المستخدم الحالي من
//                                 GET /api/bookings و يخزّنها في myBookingsCache.
//      - renderMyBookings()    : بيرسم كروت الحجوزات مقسّمة:
//                                  • قادمة (Upcoming)
//                                  • سابقة (Past)
//                                  • ملغاة (Cancelled)
//        مع زر تذكير 🔔 وزر إلغاء لكل حجز قادم.
//      - handleToggleReminder() : ضغط زر التذكير (مع طلب الصلاحية لو لأول مرة).
//      - handleCancelMyBooking(): إلغاء الحجز بإرسال PATCH /api/bookings/{id}
//                                  بحالة "cancelled"، ومسح تذكيره.
//
//   3) تشغيل التطبيق (DOMContentLoaded)
//      • أول ما الصفحة تخلص تحميل (document.addEventListener('DOMContentLoaded')):
//          - بيتحقّق لو فيه token محفوظ → يستدعي /api/me ويملا auth.user.
//          - updateAuthUI() علشان الـ navbar يظهر الحالة الصحيحة.
//          - يجيب الأطباء من /api/doctors و العيادات من /api/clinics.
//          - renderSpecialties() / renderDoctors() / renderClinics().
//          - يربط كل الأزرار (search, filters, login buttons، إلخ) بـ
//            addEventListener.
//          - يبدأ interval فحص التذكيرات (كل 60 ثانية).
//
//      • Event delegation عام على document.body:
//          - click handler عام بيمسك الضغطات على أي عنصر فيه data-action
//            (book-doctor، open-profile، إلخ) وبيوجّهها للدالة الصح.
//          - keydown handler عام لإغلاق المودالز بـ Escape.
//
// ملاحظة: ده آخر ملف بيتحمّل، وبيفترض إن كل اللي قبله موجود.
// ============================================================

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
