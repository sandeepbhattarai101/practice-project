# Running Practice Project locally

Three things run side by side:

| Piece | What it is | Where |
|---|---|---|
| Database + mail | PostgreSQL 16 and Mailpit in Docker | Postgres `localhost:5434`, Mailpit inbox <http://localhost:8026> |
| Backend (BE) | Java 21, Spring Boot 3.5, Gradle | <http://localhost:8090> (Swagger UI: <http://localhost:8090/swagger-ui.html>) |
| Frontend (FE) | React 19, Vite, TypeScript | <http://localhost:5180> |

The frontend dev server proxies `/api/*` to the backend, so in the browser everything is same-origin on :5180.

## 1. Prerequisites (one-off)

- **JDK 21** (Temurin). Gradle runs on 21. On this machine: `C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot`.
- **Node 20+** (24 works).
- **Docker**. On this laptop Docker Desktop is blocked by policy, so Docker Engine runs inside WSL `Ubuntu-24.04`.
- Google Chrome (only for the end-to-end tests).

## 2. Start the database and mail catcher

From the `practice-project` folder, in **PowerShell**:

```powershell
# WSL shuts its VM down when nothing is attached, so keep this window open (the "sleep infinity" holds it).
wsl -d Ubuntu-24.04 -u root -- sh -c "docker compose -f /mnt/c/Users/SandeepBhattaraiFigs/figsflow-onboarding/practice-project/docker-compose.yml up -d && sleep infinity"
```

On a normal machine with Docker Desktop, run `docker compose up -d`.

The first boot also creates the `practice_test` database used by the backend tests (`scripts/db-init`).

## 3. Start the backend

A second PowerShell window:

```powershell
cd practice-project\backend
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot"
.\gradlew.bat bootRun
```

On start-up:
1. **Flyway** applies `src/main/resources/db/migration/V1..V5` (schema, constraints, indexes, triggers).
2. **DevDataSeeder** fills an empty database with sample data: 3 cities, 4 cinemas, 9 auditoriums with seat layouts, movies, coupons, promotions and users, plus about a week of rolling showtimes.

It is ready when the log prints `Started PracticeProjectApplication`.

**Real movie titles and posters (optional):** `node scripts/import-qfx-catalogue.mjs` snapshots QFX Cinemas' public "now showing" list (titles and poster links) into `backend/src/main/resources/seed/qfx-now-showing.json`. The seeder uses it when the file exists and the database is empty. The file is git-ignored on purpose: the posters and synopses are copyrighted, so keep this for local learning only.

Development logins (created by the seeder; development only):

| Role | Email | Password |
|---|---|---|
| Admin | `admin@practice-project.local` | `Admin@12345` |
| Cinema manager (Durbar Marg) | `manager@practice-project.local` | `Manager@12345` |
| Customer | `customer@practice-project.local` | `Customer@12345` |

## 4. Start the frontend

A third PowerShell window:

```powershell
cd practice-project\frontend
npm install        # first time only
npm run dev        # http://localhost:5180
```

## 5. Try the full flow

1. Open <http://localhost:5180>, pick a movie, choose a showtime, then pick seats.
2. At checkout, enter your details, try the code `WELCOME10` or `FLAT100`, and choose **Payment simulator (development)**.
3. On the simulator page, choose **Approve payment**. You land on your ticket with a QR code and a tax invoice.
4. Open <http://localhost:8026> to see the confirmation email.
5. Sign in as admin, then go to <http://localhost:5180/admin> for the dashboard, scheduling, layouts, billing and reports.

**eSewa (test mode)** uses eSewa's public UAT sandbox. On their page, use their documented test wallet (see <https://developer.esewa.com.np>). No real money moves.

## 6. Tests

```powershell
# Backend unit + integration tests (needs Postgres running; uses the practice_test database)
cd backend; .\gradlew.bat test

# Frontend unit/component tests, types, lint, production build
cd frontend; npm run test; npm run typecheck; npm run lint; npm run build

# End-to-end in real Chrome (needs the backend AND frontend running)
cd frontend; npm run e2e      # screenshots in frontend/e2e/screenshots, report in frontend/e2e/report
```

## 7. Look inside the database

```powershell
wsl -d Ubuntu-24.04 -u root -- docker exec -it pp-postgres psql -U practice -d practice
```

Useful queries while you click around:

```sql
\dt                                           -- list tables
select * from seat_reservations;              -- live holds and sales (the double-booking guard)
select reference, status, total_minor from bookings order by id desc limit 10;
select invoice_number, kind, total_minor from invoices;
select type, status, recipient from notifications;   -- the email outbox
select * from flyway_schema_history;          -- which migrations ran
```

Or connect any SQL client (DBeaver, the VS Code PostgreSQL extension) to `localhost:5434`, database `practice`, user and password `practice`.

## 8. Reset everything

```powershell
wsl -d Ubuntu-24.04 -u root -- docker exec pp-postgres psql -U practice -d practice -c "drop schema public cascade; create schema public;"
```

Then restart the backend: Flyway rebuilds the schema and the seeder refills it.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Connection to localhost:5434 refused` | The WSL VM stopped. Re-run step 2 and keep that window open. |
| `Port 8090 already in use` | An old backend JVM is still running: `netstat -ano \| findstr :8090`, then `taskkill /PID <pid> /F`. |
| Gradle says "Unsupported class file major version" | `JAVA_HOME` points at JDK 25. Set it to JDK 21 (step 3). |
| The browser shows `CSRF_INVALID` | Refresh the page. The app fetches a fresh token on load. |
| No emails arrive | Check that Mailpit is up at <http://localhost:8026>. Emails are sent by a background job about every 5 seconds. |
