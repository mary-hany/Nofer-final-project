# Nofer

Arabic-language clinic/doctor booking site. PHP + SQLite backend, vanilla JS frontend.

## File layout

```
Nofer/
├── index.html        # markup (incl. login + register modals)
├── style.css         # all styles
├── script.js         # main frontend logic + auth client
├── script_doctors.js # photo enrichment
├── backend.php       # PHP API
├── database.sql      # SQLite schema + seed data
└── manifest.json     # PWA manifest
```

All files live in one directory.

## Running

```bash
cd Nofer
sqlite3 clinics.db < database.sql   # optional — backend.php auto-creates the schema too
php -S 127.0.0.1:8000
# open http://127.0.0.1:8000/
```

## Auth

- **Identifier:** email **or** phone (either one — both are unique, both can be used to log in)
- **Sessions:** server-side, DB-backed. Token = 64 random hex chars. Only the SHA-256 hash is stored. Sent as `Authorization: Bearer <token>` from the frontend. 30-day lifetime.
- **Booking requires login.** Anonymous `POST /api/bookings` returns 401. Clicking "احجز موعد" while logged out pops the login modal; on successful login the booking flow resumes automatically.
- **Rate limit:** 10 failed login attempts per IP per 15-minute window → 429.
- **Passwords:** `password_hash()` with PHP's default (bcrypt → argon2id as PHP rolls forward). Re-hashed on successful login if cost has changed. 8–128 chars.

## API

| Method | Path             | Auth | Notes                                                       |
|-------:|------------------|:----:|-------------------------------------------------------------|
| GET    | `/api/doctors`   |  —   | Top 50 by rating                                            |
| GET    | `/api/clinics`   |  —   | Top 50 by rating                                            |
| POST   | `/api/register`  |  —   | `{ name, email?, phone?, password }` — one of email/phone required; auto-issues a session |
| POST   | `/api/login`     |  —   | `{ identifier, password }` — identifier is email or phone   |
| POST   | `/api/logout`    |  ✓   | Revokes the current token                                   |
| GET    | `/api/me`        |  ✓   | Returns the current user                                    |
| POST   | `/api/bookings`  |  ✓   | Creates a booking linked to the user                        |
| GET    | `/api/bookings`  |  ✓   | Lists the current user's bookings                           |

All endpoints return `{ "success": bool, ... }`. Errors use HTTP status + `{ "success": false, "error": "..." }`.

## Schema

- `users` — id, name, email (unique, nullable), phone (unique, nullable), password_hash, created_at
- `sessions` — id, user_id, token_hash (unique), created_at, expires_at (epoch seconds)
- `login_attempts` — id, ip, attempted_at (used by rate limit, auto-pruned)
- `doctors`, `clinics` — unchanged from before
- `bookings` — now has `user_id` FK (`ON DELETE SET NULL`); creator is whoever was logged in

## Notes for production

- Set a real origin in `ALLOWED_ORIGINS` (top of `backend.php`).
- Put `clinics.db` outside the web root, or block it via your web server config.
- The "payment method" field is recorded but no money moves yet — wire up a PSP (Fawry, Paymob, Stripe) before going live.
- If you sit behind a proxy/CDN, update `client_ip()` to read the real IP (currently reads `REMOTE_ADDR` only, which is intentional — `X-Forwarded-For` can be spoofed if you trust it blindly).
- Consider adding email/phone verification (out of scope here).
