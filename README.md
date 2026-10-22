# Practice Project: cinema ticket booking

A full-stack cinema booking platform built as a **learning project**. The focus is backend and database engineering that holds up under real-world pressure: concurrent seat sales, payment verification, idempotency, refunds and billing.

| | |
|---|---|
| **Frontend** | React 19, Vite, TypeScript, TanStack Query, Tailwind CSS v4 (`frontend/`) |
| **Backend** | Java 21, Spring Boot 3.5, Spring Security, Spring Data JPA + JdbcTemplate, Flyway (`backend/`) |
| **Database** | PostgreSQL 16: constraints, partial and GIN indexes, an exclusion constraint, a trigger, LISTEN/NOTIFY |
| **Payments** | eSewa ePay v2 (public UAT sandbox), Khalti ePayment (needs a key), and a development payment simulator |
| **Email** | Transactional outbox, sent over SMTP. Mailpit catches all mail locally |

> This is a practice project, not a real cinema. Showtimes are generated sample data.

## Quick start

Full instructions are in **[docs/RUNNING.md](docs/RUNNING.md)**. In short:

```powershell
docker compose up -d                                      # Postgres :5434 + Mailpit :8026 (via WSL on this laptop, see RUNNING.md)
cd backend;  .\gradlew.bat bootRun                        # http://localhost:8090  (JDK 21)
cd frontend; npm install; npm run dev                     # http://localhost:5180
```

Admin: `admin@practice-project.local` / `Admin@12345`, then open <http://localhost:5180/admin>.

## What's inside

**Customers**
- Browse movies and cinemas, search with typo tolerance, and use a hero carousel.
- Every movie shows showtimes in every city, with your city first.
- Live seat map: seats held or sold by others update within about a second over Server-Sent Events.
- Timed seat holds (8 minutes) that can't be double-sold.
- Coupons, itemised pricing (fees, VAT) and guest or logged-in checkout.
- eSewa (test) or simulator payment, verified server-to-server before a booking is confirmed.
- Ticket with QR code, printable tax invoice, cancellation with refund and credit note, and email confirmations.
- Account pages: booking history, profile, password reset and email verification.

**Admin and cinema managers**
- Dashboard.
- Movies (with TMDB import when a key is set), cinemas and auditoriums.
- A drag-to-paint **seat layout editor**.
- Showtime scheduling, including bulk scheduling and overlap protection.
- Bookings, payments and their event log, the refunds queue, and a billing ledger with CSV export.
- Coupons, promotions, users and roles, settings, reports (sales, occupancy, CSV) and an audit log.
- Door check-in by scanning the QR code.
- Cinema managers only see their own cinemas.

## Documentation

| Doc | For |
|---|---|
| [docs/RUNNING.md](docs/RUNNING.md) | Running the backend and frontend locally, test logins, resetting the database |
| [docs/LEARNING-GUIDE.md](docs/LEARNING-GUIDE.md) | **Start here to learn.** A guided tour of the backend and database concepts, with file pointers |
| [docs/API.md](docs/API.md) | The HTTP contract between frontend and backend (Swagger UI at `/swagger-ui.html` when running) |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Environment variables, production checklist, how to deploy |
| [docs/READINESS.md](docs/READINESS.md) | Honest status: what's done and tested, and what's missing before real customers |

## Tests

```powershell
cd backend;  .\gradlew.bat test          # 29 unit + integration tests against real Postgres (practice_test DB)
cd frontend; npm run test                # 112 unit/component tests (Vitest)
cd frontend; npm run e2e                 # Playwright end-to-end in Chrome (needs both servers running)
```
