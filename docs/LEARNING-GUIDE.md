# Learning guide: backend and databases through a booking system

This project was built so you can learn by reading working code. Each section explains one idea, why it matters for a cinema, and exactly where to look. Read them in order; each builds on the last.

Open two things side by side: the file mentioned, and a `psql` session (see RUNNING.md §7) so you can watch the tables change while you click around the app.

---

## 1. How a request flows through the backend

```
Browser ──HTTP──> Filters ──> Controller ──> Service ──> Repository ──> PostgreSQL
                  (security,   (HTTP in/out,  (business   (SQL / JPA)
                   rate limit)  validation)    rules, @Transactional)
```

- **Controller**: turns HTTP into method calls and back, with no business rules. Example: `booking/BookingController.java`.
- **Service**: the rules ("can this booking be cancelled?"), and the **transaction boundary**. Example: `booking/BookingService.java`.
- **Repository**: talks to the database. This project uses both styles on purpose:
  - **Spring Data JPA** for simple entity writes (`BookingRepository`, `User`, `Movie`).
  - **JdbcTemplate with hand-written SQL** for anything interesting (`SeatHoldRepository`, `CatalogQueries`, `ReportService`).

  Real teams use both. SQL is the skill that transfers everywhere.

Try it: put a breakpoint in `BookingController.hold`, book a seat in the UI, and step through to `SeatHoldRepository.claim`.

## 2. Schema design and migrations (Flyway)

The database schema lives in plain SQL files: `backend/src/main/resources/db/migration/V1..V5`. Flyway runs each file **once**, in order, and records it in `flyway_schema_history`.

Rule: never edit a migration that has already run. Add `V6__...sql` instead. (Production databases can't be "re-created"; they can only move forward.)

Things to notice in V1 to V3:

| Concept | Where | Why |
|---|---|---|
| `BIGINT GENERATED ALWAYS AS IDENTITY` | every table | Modern auto-increment primary keys |
| Foreign keys + `ON DELETE CASCADE / SET NULL` | `seats → auditoriums`, `bookings.user_id` | The database refuses orphans; you choose what happens on delete |
| `CHECK` constraints | `bookings.status`, `CHECK (total_minor >= 0)` | Bad data is rejected even if the Java code has a bug |
| Money as `BIGINT` paisa | `price_minor`, `total_minor` | Floats can't represent 0.1 exactly; money must be exact |
| `TIMESTAMPTZ` | everywhere | Store instants in UTC; convert to Kathmandu time only for display |
| Postgres arrays `TEXT[]` and `JSONB` | `movies.genres`, `movies.cast_members` | Good for small lists read with the row; use join tables when you query them a lot |

## 3. Indexes: making reads fast

An index is a sorted lookup structure. Without one, Postgres reads every row (a "sequential scan").

| Index | Type | Serves |
|---|---|---|
| `ux_users_email_lower` on `lower(email)` | **expression** unique index | Case-insensitive login and "email already registered" |
| `ix_bookings_hold_expiry ... WHERE status IN ('HELD','PAYMENT_PENDING')` | **partial** index | The expiry job scans only open bookings, so the index stays tiny |
| `ix_movies_search` on a generated `tsvector` | **GIN** full-text | Search across title, director and synopsis |
| `ix_movies_title_trgm` | **GIN trigram** (`pg_trgm`) | Typo-tolerant suggestions ("jailr" finds "Jailer 2") |
| `ix_showtimes_movie_start (movie_id, starts_at)` | **composite** | "Shows of movie X from now on", the most common query |

Try it in psql:

```sql
EXPLAIN ANALYZE select * from movies where lower(title) like '%jail%';
EXPLAIN ANALYZE select id from bookings where status in ('HELD','PAYMENT_PENDING') and hold_expires_at < now();
```

Look for `Index Scan` or `Bitmap Index Scan` versus `Seq Scan`. (On tiny tables Postgres may still choose a seq scan, because it's cheaper. That's correct!)

## 4. ⭐ The double-booking problem (the core lesson)

Two customers click seat **F7** for the 7 pm show at the same millisecond. Both requests check "is F7 free?", both see yes, and both insert. You've sold one seat twice.

**"Check then insert" is always a race.** The fix is to let the database decide atomically:

1. `seat_reservations` has `PRIMARY KEY (showtime_id, seat_id)` (V3). Postgres physically cannot store two rows for the same seat and show.
2. `SeatHoldRepository.claim()` runs a single statement:

   ```sql
   INSERT INTO seat_reservations (...) SELECT ... FROM unnest(:seatIds) ORDER BY s
   ON CONFLICT (showtime_id, seat_id) DO UPDATE SET ...
       WHERE seat_reservations.status = 'HELD' AND seat_reservations.expires_at <= now()
   RETURNING seat_id
   ```

   - A free seat is inserted.
   - An **expired** hold is taken over.
   - A live hold or a sold seat is left alone, so its id is *not* returned.

   Java compares "asked for" against "got" and **throws**, which rolls back the whole transaction, including the booking row.
3. `ORDER BY s` makes every request lock seats in the same order, which prevents **deadlocks**. (Two transactions each holding a lock the other needs would wait on each other forever.)

**Proof:** `SeatHoldConcurrencyTest` fires 20 threads at one seat and asserts exactly one winner. Run it and read it.

## 5. Transactions, isolation and locks

`@Transactional` on a service method means: one database transaction; all statements commit together or none do.

| Tool | Where | What it prevents |
|---|---|---|
| **Pessimistic lock** `SELECT ... FOR UPDATE` | `BookingRepository.lockByReference` | Payment confirmation and the expiry job both modifying one booking at once |
| **Shared lock** `FOR SHARE` | `BookingQueries.lockShowForShare` | An admin cancelling a show halfway through someone's seat hold |
| **Optimistic lock** `@Version` column | `Booking.version`, `Payment.version` | Lost updates. Hibernate adds `WHERE version = ?`; the loser gets a 409 instead of silently overwriting |
| **Row lock on a counter** | `coupons` (`CouponRepository.lockByCode`) | Two people taking the last remaining use of a coupon (`CouponConcurrencyTest`) |
| **Lock ordering** | `PaymentService.apply`: payment, *then* booking, everywhere | Deadlocks |
| **Short transactions around network calls** | `PaymentService.start` uses `TransactionTemplate`: commit, call the gateway, commit | Holding row locks while waiting seconds for eSewa to answer |

## 6. Constraints the application can't get wrong

Some rules are enforced in the database itself, so no bug or second app instance can break them:

- **Exclusion constraint** (V2, `ex_showtimes_no_overlap`): two shows in one auditorium can't overlap in time. It needs `btree_gist`, and you can read it as "no two rows with the same `auditorium_id` AND overlapping `tstzrange(starts_at, ends_at)`". Try scheduling a clash in admin and you'll get `SHOWTIME_OVERLAP`.
- **Partial unique index** `ux_payments_one_success`: at most ONE successful payment per booking.
- **Partial unique index** `ux_cities_single_default`: only one default city.
- **Trigger** `trg_invoices_immutable` (V5): issued invoices can't be updated or deleted, even by an admin running SQL by hand.
- **CHECK** in `invoices`: `total = subtotal - discount + fee + tax`, so totals must add up.

## 7. Payments done properly

Read `payment/PaymentService.java` and `payment/PaymentProvider.java`.

1. **Never trust the browser.** The gateway redirects the customer to `/api/payments/esewa/callback/...`. We treat that as a *hint* only and call eSewa's **status API server-to-server** (`EsewaProvider.check`). Only that answer can confirm a booking.
2. **Signatures**: eSewa signs with HMAC-SHA256 (`Tokens.hmacSha256Base64`). This was verified against eSewa's live UAT server; see `EsewaSignatureTest`.
3. **Idempotency**: the frontend sends an `Idempotency-Key` header with "Pay". A double click or a retry after a timeout returns the *same* payment (`payments.idempotency_key UNIQUE`).
4. **Reconciliation**: if the customer closes the tab after paying, `BookingJobs.reconcilePayments` asks the gateway about open payments every minute.
5. **Late payment**: the hold expired and someone else bought the seat, then the money arrives. `BookingService.confirmPaid` refunds instead of double-selling (`BookingFlowTest.paymentThatArrivesAfterTheSeatWasResold`).
6. **Append-only event log**: `payment_events` keeps everything every gateway told us, which is what you'd show in a dispute.

## 8. Background jobs and work queues

- `BookingJobs.expireHolds` (every 15 s): releases seats from expired holds.
- `NotificationDispatcher` (every 5 s): sends emails from the **outbox**.

**Transactional outbox** (V4 `notifications`): the email row is inserted in the *same transaction* as the booking change. If the booking rolls back, the email never existed. A job sends pending rows using

```sql
SELECT ... FOR UPDATE SKIP LOCKED
```

That turns a table into a safe multi-worker queue: a second app instance skips rows the first is already sending.

## 9. Real-time with Postgres LISTEN/NOTIFY

`SeatHoldRepository.notifySeatsChanged` runs `pg_notify('seat_events', showtimeId)` inside the transaction. Postgres delivers it **only on commit**. `SeatEvents` keeps one connection on `LISTEN seat_events` and pushes a Server-Sent Event to every browser watching that show. Because Postgres does the fan-out, this works across several backend instances with no Redis or message broker.

## 10. Security

| Topic | Where |
|---|---|
| Password hashing (bcrypt, upgradeable `{bcrypt}` prefix) | `SecurityConfig.passwordEncoder`, `AuthService` |
| Sessions stored in Postgres (`spring_session`), survive restarts | `spring-session-jdbc`, V4 |
| Session fixation defence (new session id at login) | `SessionAuth.login` |
| CSRF double-submit cookie (`XSRF-TOKEN` → `X-XSRF-TOKEN` header) | `SecurityConfig` |
| Account lockout after 5 failed logins | `AuthService.authenticate` |
| Rate limiting on login, holds, coupons, payments | `common/RateLimitFilter` |
| Ownership checks (404 rather than 403 so references can't be probed) | `booking/BookingAccess` |
| Role and cinema scoping for managers, enforced *in SQL* | `admin/AdminScope` |
| Role changes and disabling take effect on the next request | `auth/SessionUserRefreshFilter` |
| Tokens stored hashed (email links, guest access) | `user_tokens.token_hash`, `bookings.access_token_hash` |
| CSV formula-injection protection | `ReportService.cell`, `BillingService.csvCell` |

## 11. Billing

- **Gap-free invoice numbers** (V5): a `SEQUENCE` can skip numbers on rollback, and tax invoices usually must not. The `invoice_counters` row is bumped with `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, which locks the row and rolls back with the transaction.
- **Snapshots**: invoices copy names, addresses and prices at issue time, so later edits never rewrite history. `booking_items` does the same for seat prices.
- **Credit notes**, not edits: a refund issues a new document that points at the original.

## 12. Testing against a real database

`backend/src/test/java/.../IntegrationTest.java` boots the whole app against the `practice_test` database and wipes it before each test with `TRUNCATE ... RESTART IDENTITY CASCADE`.

Lesson learned while building this: `CASCADE` follows foreign keys. `app_settings.updated_by → users` meant truncating `users` also emptied `app_settings`, and tests then silently ran with default settings. The fix (re-insert the defaults from the migrations) is in `restoreDefaultSettings()`.

## Exercises

1. Add a `V6__seat_notes.sql` migration adding an optional `notes TEXT` column to `seats`, and show it in the admin layout API.
2. Write `EXPLAIN ANALYZE` for the seat map query in `ShowtimeController.seats` and identify which index each join uses.
3. Add a "per-show maximum of 4 seats per customer" rule. Where should it live: Java, a CHECK, or a trigger? Why?
4. Make the expiry job emit a metric of how many holds expired (Spring Boot Actuator + Micrometer).
5. Break the double-booking guard on purpose: replace `claim()` with "SELECT then INSERT" and watch `SeatHoldConcurrencyTest` fail. Then put it back!
