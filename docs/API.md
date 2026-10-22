# Practice Project — HTTP API contract

Base path: `/api`. JSON everywhere, camelCase keys. Interactive docs when the backend runs: <http://localhost:8090/swagger-ui.html>.

## Conventions

| Topic | Rule |
|---|---|
| Money | Integer **minor units** (paisa). `150000` = Rs. 1,500.00. The currency comes from `GET /api/config`. |
| Instants | ISO-8601 with offset, e.g. `2026-10-22T18:30:00Z`. Display them in the cinema's `timezone` (default `Asia/Kathmandu`). |
| Dates | `YYYY-MM-DD`, meaning the calendar date in the cinema's timezone. |
| Paging | `?page=0&size=20`. Response: `{ items, page, size, totalItems, totalPages }`. |
| Auth | Session cookie (`PPSESSION`, httpOnly). Send requests with `credentials: 'include'` (or run same-origin through the Vite proxy). |
| CSRF | Every non-GET request must send the `X-XSRF-TOKEN` header, set to the value of the `XSRF-TOKEN` cookie. Call `GET /api/auth/csrf` once at start-up to receive the cookie. |
| Errors | `{ "error": { "code", "message", "fieldErrors"?: [{ "field", "message" }], "details"?: {} }, "requestId" }`. |

Common error codes: `VALIDATION_FAILED` (400), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `SEATS_UNAVAILABLE` (409, `details.seatIds`), `HOLD_EXPIRED` (409), `SHOWTIME_OVERLAP` (409), `SALES_CLOSED` (422), `COUPON_INVALID` (422), `BOOKING_STATE` (422), `PAYMENT_PROVIDER_UNAVAILABLE` (503), `RATE_LIMITED` (429), `INTERNAL_ERROR` (500).

## Shared shapes

```ts
type Role = 'CUSTOMER' | 'CINEMA_MANAGER' | 'ADMIN';
type User = { id: number; email: string; fullName: string; phone: string | null; role: Role;
  emailVerified: boolean; preferredCitySlug: string | null; marketingOptIn: boolean; managedCinemaIds: number[] };

type City = { id: number; name: string; slug: string; isDefault: boolean };

type MovieCard = { id: number; slug: string; title: string; tagline: string | null;
  posterUrl: string; backdropUrl: string; trailerUrl: string | null;
  runtimeMinutes: number; releaseDate: string; certification: string;
  languages: string[]; genres: string[];
  formats: string[];                     // formats actually scheduled (in the selected city when given)
  showingStatus: 'NOW_SHOWING' | 'UPCOMING' | 'NOT_SCHEDULED';
  isSampleData: boolean };               // show a "Development data" badge when true

type MovieDetail = MovieCard & { synopsis: string; director: string | null;
  cast: { name: string; character: string | null }[] };

type CinemaCard = { id: number; slug: string; name: string; address: string; cityName: string; citySlug: string;
  imageUrl: string; facilities: string[]; formats: string[]; phone: string | null;
  latitude: number | null; longitude: number | null; directionsUrl: string; timezone: string };

type CinemaDetail = CinemaCard & { description: string | null;
  auditoriums: { id: number; name: string; formats: string[]; seatCount: number }[] };

type ShowtimeChip = { id: number; startsAt: string; format: string; language: string;
  cinemaSlug: string; cinemaName: string; auditoriumName: string; timezone: string;
  seatsAvailable: number; seatsTotal: number;
  availability: 'AVAILABLE' | 'FILLING_FAST' | 'SOLD_OUT';
  minPriceMinor: number; maxPriceMinor: number;
  salesOpen: boolean };                  // false once sales close (N minutes before start) or admin closed them

type Promotion = { id: number; title: string; subtitle: string | null; imageUrl: string | null;
  ctaLabel: string | null; ctaUrl: string | null; couponCode: string | null };

type BookingStatus = 'HELD' | 'PAYMENT_PENDING' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED';
type PaymentStatus = 'INITIATED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
type ProviderCode = 'ESEWA' | 'KHALTI' | 'DEV_SANDBOX';

type Booking = {
  reference: string; status: BookingStatus;
  showtime: { id: number; startsAt: string; endsAt: string; format: string; language: string; timezone: string;
    movie: { slug: string; title: string; posterUrl: string; certification: string; runtimeMinutes: number };
    cinema: { slug: string; name: string; address: string };
    auditorium: { name: string } };
  items: { seatId: number; seatLabel: string; categoryName: string; priceMinor: number }[];
  pricing: { subtotalMinor: number; discountMinor: number; feeMinor: number; taxMinor: number;
    taxLabel: string; taxRateBasisPoints: number; totalMinor: number; currency: string };
  coupon: { code: string; description: string } | null;
  customer: { name: string | null; email: string | null; phone: string | null };
  holdExpiresAt: string; confirmedAt: string | null; cancelledAt: string | null; cancellationReason: string | null;
  ticket: { code: string; qrPayload: string; qrUrl: string } | null;     // only when CONFIRMED
  checkedInAt: string | null;
  payments: { id: number; provider: ProviderCode; status: PaymentStatus; amountMinor: number;
    createdAt: string; completedAt: string | null; failureReason: string | null }[];
  refund: { amountMinor: number; status: 'PENDING' | 'PROCESSED' | 'REJECTED'; createdAt: string; processedAt: string | null } | null;
  cancellable: boolean; cancellationRefundMinor: number;   // what a customer cancellation would refund now
  createdAt: string };

type BookingSummary = { reference: string; status: BookingStatus; movieTitle: string; posterUrl: string;
  cinemaName: string; startsAt: string; timezone: string; seatLabels: string[]; totalMinor: number; createdAt: string };
```

## Public config and auth

| Method & path | Body | Response |
|---|---|---|
| `GET /api/config` | | `{ currency, currencySymbol, holdMinutes, maxSeatsPerBooking, serviceFeeMinor, taxRateBasisPoints, taxLabel, cancellation: { cutoffHours, refundPercent }, paymentProviders: [{ code, name, mode: 'TEST'\|'LIVE'\|'SIMULATOR' }], supportEmail, tmdbEnabled }` |
| `GET /api/auth/csrf` | | 204 and sets the `XSRF-TOKEN` cookie |
| `GET /api/auth/me` | | `{ user: User \| null }` |
| `POST /api/auth/register` | `{ email, password, fullName, phone? }` | `{ user }`, logged in. Password: 10–128 characters, including a letter and a digit |
| `POST /api/auth/login` | `{ email, password }` | `{ user }`. 401 `INVALID_CREDENTIALS`; 423 `ACCOUNT_LOCKED` |
| `POST /api/auth/logout` | | 204 |
| `POST /api/auth/verify-email` | `{ token }` | 204 |
| `POST /api/auth/resend-verification` | | 204 (needs auth) |
| `POST /api/auth/forgot-password` | `{ email }` | 204 always (no account enumeration) |
| `POST /api/auth/reset-password` | `{ token, password }` | 204 |
| `PUT /api/me/profile` | `{ fullName, phone, preferredCitySlug, marketingOptIn }` | `{ user }` |
| `PUT /api/me/password` | `{ currentPassword, newPassword }` | 204 |
| `GET /api/me/bookings?scope=upcoming\|past\|all&page&size` | | `Page<BookingSummary>` |

## Catalogue (public)

| Method & path | Response |
|---|---|
| `GET /api/cities` | `City[]` |
| `GET /api/home?city=` | `{ city, featured: MovieCard[], nowShowing: MovieCard[], upcoming: MovieCard[], cinemas: CinemaCard[], promotions: Promotion[], todayShowtimes: { movie: MovieCard, showtimes: ShowtimeChip[] }[] }` |
| `GET /api/movies?city&q&genre&language&format&cinema&when=now\|upcoming\|all&date&sort=popular\|release\|title&page&size` | `Page<MovieCard>` |
| `GET /api/movies/suggest?q&city` | `{ slug, title, posterUrl, releaseDate, genres }[]` (max 8, typo-tolerant) |
| `GET /api/movies/filters?city` | `{ genres: string[], languages: string[], formats: string[], cinemas: { slug, name }[] }` |
| `GET /api/movies/{slug}` | `MovieDetail` |
| `GET /api/movies/{slug}/dates?city` | `string[]`: dates that have bookable shows |
| `GET /api/movies/{slug}/showtimes?city&date` | `{ cinema: CinemaCard, showtimes: ShowtimeChip[] }[]` |
| `GET /api/movies/{slug}/related` | `MovieCard[]` |
| `GET /api/cinemas?city&q&format` | `CinemaCard[]` |
| `GET /api/cinemas/{slug}` | `CinemaDetail` |
| `GET /api/cinemas/{slug}/dates` | `string[]` |
| `GET /api/cinemas/{slug}/showtimes?date&movie` | `{ movie: MovieCard, showtimes: ShowtimeChip[] }[]` |
| `GET /api/promotions` | `Promotion[]` |
| `GET /api/media/artwork/{poster\|backdrop}/{slug}.svg` | Generated SVG artwork for sample movies |

## Showtimes and seats

| Method & path | Response |
|---|---|
| `GET /api/showtimes/{id}` | `{ id, startsAt, endsAt, format, language, status, salesOpen, salesCloseAt, timezone, movie: MovieCard, cinema: CinemaCard, auditorium: { id, name }, prices: { categoryId, code, name, color, priceMinor }[] }` |
| `GET /api/showtimes/{id}/seats` | `{ showtimeId, gridRows, gridCols, categories: { id, code, name, color, priceMinor }[], seats: { id, label, rowLabel, number, gridRow, gridCol, categoryId, type: 'STANDARD'\|'WHEELCHAIR'\|'COMPANION'\|'COUPLE', state: 'AVAILABLE'\|'HELD'\|'SOLD'\|'MINE'\|'UNAVAILABLE' }[], myBookingReference: string \| null, myHoldExpiresAt: string \| null }` |
| `GET /api/showtimes/{id}/seats/stream` | Server-Sent Events. The `seats-changed` event carries `{ showtimeId }`; on it, refetch `/seats`. |

`gridRow` and `gridCol` are 1-based cells. Empty cells are aisles.

## Booking

| Method & path | Body | Response |
|---|---|---|
| `POST /api/bookings` | `{ showtimeId, seatIds }` | 201 `Booking` (status `HELD`). Replaces this browser's earlier hold on the same show. 409 `SEATS_UNAVAILABLE` |
| `GET /api/bookings/{ref}` | | `Booking` (owner, or a guest whose session created or looked it up) |
| `PUT /api/bookings/{ref}/customer` | `{ name, email, phone }` | `Booking` |
| `POST /api/bookings/{ref}/coupon` | `{ code }` | `Booking`. 422 `COUPON_INVALID` with a human-readable message |
| `DELETE /api/bookings/{ref}/coupon` | | `Booking` |
| `POST /api/bookings/{ref}/release` | | 204 (abandon the hold) |
| `POST /api/bookings/{ref}/payments` | `{ provider }` plus the `Idempotency-Key` header (UUID) | `{ paymentId, provider, redirect: { method: 'GET'\|'POST', url, fields: Record<string,string> } }`. For POST, the frontend builds a form and submits it |
| `POST /api/bookings/{ref}/payments/verify` | | `Booking`. Asks the gateway again about any pending payment (the recovery button) |
| `POST /api/bookings/{ref}/cancel` | `{ reason? }` | `Booking` |
| `POST /api/bookings/{ref}/resend` | | 204 |
| `GET /api/bookings/{ref}/qr.png` | | PNG |
| `POST /api/bookings/lookup` | `{ reference, email }` or `{ reference, token }` | `Booking`. Grants this session access |

After payment the gateway returns to the **backend**. The backend verifies the payment server-side, then redirects the browser to
`{FRONTEND_URL}/bookings/{ref}?payment=success|failed|cancelled|pending`.
The page must trust only the `Booking.status` it fetches, **never** the query string.

## Admin (`/api/admin`, ADMIN; CINEMA_MANAGER where marked ⓜ, scoped to their cinemas)

| Area | Endpoints |
|---|---|
| Lookups ⓜ | `GET /lookups` returns `{ cities: City[], cinemas: { id, name, citySlug, auditoriums: { id, name, formats, categories: { id, code, name }[] }[] }[], movies: { id, title, languages, runtimeMinutes, status }[] }` |
| Dashboard ⓜ | `GET /dashboard?cinemaId` returns `{ today: { bookings, tickets, revenueMinor }, last30Days: { bookings, tickets, revenueMinor }, activeHolds, upcomingShowtimes, pendingRefunds, salesByDay: { date, revenueMinor, tickets }[], topMovies: { title, revenueMinor, tickets }[], nextShowtimes: { showtimeId, movieTitle, cinemaName, auditoriumName, startsAt, sold, capacity }[] }` |
| Movies | `GET /movies?q&status&page&size`, `GET /movies/{id}`, `POST /movies`, `PUT /movies/{id}`, `POST /movies/{id}/status {status}`, `DELETE /movies/{id}` (409 when it has showtimes; archive instead). Body `MovieInput = { title, slug?, tagline, synopsis, runtimeMinutes, releaseDate, certification, languages[], genres[], director, cast: {name, character}[], trailerUrl, posterUrl, backdropUrl, status, isFeatured }`. `AdminMovie = MovieDetail & { status, isFeatured, tmdbId, createdAt, updatedAt, showtimeCount }` |
| TMDB | `GET /tmdb/search?q` returns `{ tmdbId, title, releaseDate, posterUrl, overview }[]`; `POST /tmdb/import {tmdbId}` returns `AdminMovie`. 503 `TMDB_NOT_CONFIGURED` without a key |
| Cities | `GET /cities`, `POST /cities {name, slug?, timezone, isDefault}`, `PUT /cities/{id}` |
| Cinemas | `GET /cinemas` (includes `auditoriumCount`, `status`), `GET /cinemas/{id}` (includes `auditoriums`), `POST /cinemas`, `PUT /cinemas/{id}`. Body `{ cityId, name, slug?, address, latitude, longitude, phone, description, facilities[], imageUrl, status }` |
| Auditoriums | `POST /cinemas/{cinemaId}/auditoriums {name, formats[], gridRows, gridCols}`, `PUT /auditoriums/{id} {name, formats[], isActive}`, `GET /auditoriums/{id}/layout`, `PUT /auditoriums/{id}/layout` |
| Layout shape | `{ gridRows, gridCols, categories: { code, name, color, sortOrder }[], seats: { rowLabel, seatNumber, gridRow, gridCol, categoryCode, seatType, isActive }[] }`. GET also returns `auditorium` and `locked` (true when future shows have holds or sales, in which case PUT returns 409 `LAYOUT_LOCKED`) |
| Showtimes ⓜ | `GET /showtimes?cinemaId&movieId&from&to&status&page&size` returns `Page<{ id, startsAt, endsAt, format, language, status, salesOpen, movie: {id,title}, cinema: {id,name}, auditorium: {id,name}, sold, held, capacity, prices: {categoryId, name, priceMinor}[] }>`; `POST /showtimes { movieId, auditoriumId, startsAt, format, language, bufferMinutes?, prices: {categoryId, priceMinor}[] }` (409 `SHOWTIME_OVERLAP`); `POST /showtimes/bulk { movieId, auditoriumId, dates[], times[] ("HH:mm", cinema-local), format, language, bufferMinutes?, prices }` returns `{ created, conflicts: { startsAt, message }[] }`; `PUT /showtimes/{id}` (same body; time and auditorium are locked once seats are sold); `POST /showtimes/{id}/sales {salesOpen}`; `POST /showtimes/{id}/cancel {reason}` (cancels and refunds every booking in full) |
| Bookings ⓜ | `GET /bookings?q&status&cinemaId&showtimeId&from&to&page&size` returns `Page<{ reference, status, customerName, customerEmail, movieTitle, cinemaName, startsAt, timezone, seatLabels[], totalMinor, createdAt }>`; `GET /bookings/{ref}` returns `Booking & { userId, userEmail }`; `POST /bookings/{ref}/cancel {reason, refundPercent}`; `POST /bookings/{ref}/resend` |
| Payments | `GET /payments?status&provider&q&page&size`, `GET /payments/{id}` (with `events: {eventType, payload, createdAt}[]`), `POST /payments/{id}/reconcile` |
| Refunds | `GET /refunds?status&page&size` returns `Page<{ id, bookingReference, amountMinor, status, reason, provider, providerRef, notes, createdAt, processedAt }>`; `POST /refunds/{id}/process {providerRef, notes}`; `POST /refunds/{id}/reject {notes}` |
| Coupons | `GET /coupons?page&size` (includes `usedCount`), `POST /coupons`, `PUT /coupons/{id}`. Body `{ code, description, discountType: 'PERCENT'\|'FIXED', discountValue, maxDiscountMinor, minSubtotalMinor, validFrom, validUntil, usageLimit, perUserLimit, movieId, cinemaId, isActive }`. PERCENT values are basis points (1000 = 10%) |
| Promotions | `GET /promotions`, `POST /promotions`, `PUT /promotions/{id}`, `DELETE /promotions/{id}` |
| Users | `GET /users?q&role&page&size` returns `Page<{ id, email, fullName, phone, role, status, emailVerified, createdAt, bookingCount, managedCinemaIds }>`; `PUT /users/{id} { role, status, managedCinemaIds }` |
| Reports ⓜ | `GET /reports/sales?from&to&groupBy=day\|movie\|cinema&cinemaId` returns `{ rows: { key, label, bookings, tickets, grossMinor, discountMinor, feeMinor, taxMinor, totalMinor }[], totals }`; `GET /reports/sales.csv` with the same parameters; `GET /reports/occupancy?from&to&cinemaId` returns `{ rows: { showtimeId, movieTitle, cinemaName, auditoriumName, startsAt, capacity, sold, occupancyPercent }[] }`; `GET /reports/occupancy.csv` |
| Settings | `GET /settings` returns `{ key, value, description, updatedAt }[]`; `PUT /settings { [key]: value }` |
| Check-in ⓜ | `POST /checkin/lookup {code}` and `POST /checkin/confirm {code}` both return `{ result: 'VALID'\|'ALREADY_CHECKED_IN'\|'NOT_CONFIRMED'\|'WRONG_DAY'\|'INVALID', booking: Booking \| null }` |
| Audit | `GET /audit?entityType&page&size` returns `Page<{ id, actorEmail, action, entityType, entityId, details, ipAddress, createdAt }>` |

`from` and `to` on admin filters are `YYYY-MM-DD` (inclusive).

## Billing (invoices and credit notes)

A tax invoice is issued automatically when a booking is confirmed. A credit note is issued for every refund (for example the 90% customer cancellation). Numbers are gap-free per year: `PP-INV-2026-000001` and `PP-CN-2026-000001`. Issued documents are immutable (a database trigger enforces this).

```ts
type InvoiceSummary = { number: string; kind: 'INVOICE' | 'CREDIT_NOTE'; issuedAt: string; totalMinor: number };
type Invoice = {
  number: string; kind: 'INVOICE' | 'CREDIT_NOTE'; issuedAt: string; fiscalYear: string; bookingReference: string;
  originalInvoiceNumber: string | null;                   // set on credit notes
  seller: { name: string; address: string; taxId: string | null };
  customer: { name: string; email: string | null; phone: string | null };
  currency: string;
  lines: { description: string; quantity: number; unitPriceMinor: number; amountMinor: number }[];
  subtotalMinor: number; discountMinor: number; feeMinor: number; taxMinor: number;
  taxRateBasisPoints: number; taxLabel: string; totalMinor: number;
  payment: { provider: ProviderCode; providerTxnId: string | null } | null;
  timezone: string };
```

`Booking` gains `invoices: InvoiceSummary[]`.

| Method & path | Response |
|---|---|
| `GET /api/bookings/{ref}/invoices` | `Invoice[]` (same access rules as the booking) |
| `GET /api/admin/invoices?q&kind&from&to&page&size` | `Page<Invoice>` (ADMIN) |
| `GET /api/admin/invoices/summary?q&kind&from&to` | `{ invoicedMinor, creditedMinor, netMinor, netTaxMinor, invoiceCount, creditNoteCount }` |
| `GET /api/admin/invoices/{number}` | `Invoice` |
| `GET /api/admin/invoices.csv?q&kind&from&to` | CSV ledger (credit notes as negative amounts) |
