# Deployment

The app is two deployables plus a database:

| Piece | Build | Run |
|---|---|---|
| Backend | `cd backend && ./gradlew bootJar` gives `build/libs/practice-project-backend-0.1.0-SNAPSHOT.jar` | `java -jar app.jar --spring.profiles.active=prod` (JDK 21) |
| Frontend | `cd frontend && npm ci && npm run build` gives `dist/` (static files) | Any static host or CDN (Nginx, S3 + CloudFront, Netlify, Vercel) |
| Database | PostgreSQL 16 (managed: RDS, Cloud SQL, Neon, Supabase…) | Flyway migrates automatically on backend start |

**Recommended topology:** serve the frontend and proxy `/api/*` to the backend on the **same domain** (e.g. `https://tickets.example.com` and `https://tickets.example.com/api`). Same-origin keeps cookies and CSRF simple. For separate domains, set `VITE_API_BASE_URL` at frontend build time and `ALLOWED_ORIGINS` on the backend, and serve both over HTTPS.

Example Nginx:

```nginx
server {
  server_name tickets.example.com;
  root /srv/practice-project/frontend/dist;
  location /api/ {
    proxy_pass http://127.0.0.1:8090;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;               # needed for the live seat-map stream (SSE)
    proxy_read_timeout 1h;
  }
  location / { try_files $uri /index.html; }   # SPA deep links
}
```

## Backend environment variables

| Variable | Required in prod | Purpose |
|---|---|---|
| `SPRING_PROFILES_ACTIVE=prod` | yes | Enables `ProductionSafetyCheck`, secure cookies, and disables Swagger, sample data and the simulator |
| `DATABASE_URL`, `DATABASE_USERNAME`, `DATABASE_PASSWORD` | yes | JDBC URL, e.g. `jdbc:postgresql://host:5432/practice?sslmode=require` |
| `DATABASE_POOL_SIZE` | no (15) | Hikari pool size per instance |
| `APP_SIGNING_SECRET` | yes | 32+ random characters (`openssl rand -base64 48`) |
| `FRONTEND_URL` | yes | e.g. `https://tickets.example.com`; used in emails and post-payment redirects |
| `PUBLIC_BASE_URL` | yes | The public URL of the backend; gateways call back here |
| `ALLOWED_ORIGINS` | if cross-origin | Comma-separated frontend origins |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_AUTH=true`, `SMTP_STARTTLS=true` | yes | Real email (Amazon SES, SendGrid, Postmark, Mailgun…) |
| `MAIL_FROM` | yes | e.g. `Practice Project <tickets@example.com>` (domain needs SPF/DKIM) |
| `ESEWA_ENABLED`, `ESEWA_LIVE=true`, `ESEWA_PRODUCT_CODE`, `ESEWA_SECRET_KEY`, `ESEWA_FORM_URL=https://epay.esewa.com.np/api/epay/main/v2/form`, `ESEWA_STATUS_URL=https://epay.esewa.com.np/api/epay/transaction/status/` | for eSewa | Live merchant credentials from eSewa onboarding |
| `KHALTI_SECRET_KEY`, `KHALTI_LIVE=true`, `KHALTI_BASE_URL=https://khalti.com/api/v2` | for Khalti | Live key from Khalti merchant dashboard |
| `TMDB_API_KEY` | optional | Enables admin "Import from TMDB" |
| `PAYMENT_DEV_SANDBOX_ENABLED=false`, `SEED_SAMPLE_DATA=false` | forced by prod | The safety check refuses to start otherwise |
| `JOBS_ENABLED` | no (true) | Hold expiry, payment reconciliation, email outbox |

The **prod profile refuses to start** if any development default is still set: a weak signing secret, the simulator, sample data, eSewa test credentials, or non-HTTPS URLs.

## First production start

1. Create an empty Postgres database and user.
2. Start the backend once: Flyway creates the schema (V1 to V5).
3. Create the first admin. There's no sign-up for admins, so promote a registered user:
   ```sql
   update users set role = 'ADMIN', email_verified_at = now() where lower(email) = 'you@example.com';
   ```
4. In Admin → Settings, confirm VAT/fees, hold minutes, the cancellation policy and the billing details (legal name, address, PAN/VAT number). The PAN default is a **placeholder**.
5. Create cities, cinemas, auditoriums (draw layouts), movies and showtimes.

## Scaling notes

- **Multiple backend instances are supported** for the core guarantees: seat locking happens in Postgres, sessions are in Postgres, the seat-map live updates use Postgres LISTEN/NOTIFY, and jobs use `FOR UPDATE SKIP LOCKED`.
- **Not yet multi-instance:** the rate limiter counts in memory per instance. Move it to Redis or the load balancer (Nginx `limit_req`, Cloudflare) before scaling out.
- Each instance holds one extra DB connection for `LISTEN`, and SSE connections count against the servlet thread pool (Tomcat async). Configure `proxy_buffering off` as shown.
- Back up Postgres (point-in-time recovery). Bookings, payments and invoices are financial records.

## CI suggestion

```yaml
# .github/workflows/ci.yml (outline)
services: postgres:16 (POSTGRES_USER/PASSWORD=practice, POSTGRES_DB=practice_test)
steps:
  - backend:  ./gradlew test   (TEST_DATABASE_URL=jdbc:postgresql://localhost:5432/practice_test)
  - frontend: npm ci && npm run typecheck && npm run lint && npm run test && npm run build
```
