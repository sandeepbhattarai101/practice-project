# Environment variables

Every backend setting has a working **local default** in `backend/src/main/resources/application.yml`, so nothing is required to run locally. To override settings without editing YAML, create **`backend/.env`** (it's git-ignored) with any of the lines below. The backend reads it on start (`spring.config.import`), and real environment variables still take priority.

Frontend settings are in `frontend/.env.example`.

For production values and which are mandatory, see [DEPLOYMENT.md](DEPLOYMENT.md).

```properties
# --- Server ---
PORT=8090
# true when served over HTTPS (forced on by the prod profile)
COOKIE_SECURE=false

# --- Database (docker-compose.yml starts this Postgres on 5434) ---
DATABASE_URL=jdbc:postgresql://localhost:5434/practice
DATABASE_USERNAME=practice
DATABASE_PASSWORD=practice
DATABASE_POOL_SIZE=15

# --- URLs ---
# Where the React app lives (emails, post-payment redirects)
FRONTEND_URL=http://localhost:5180
# Public URL of this backend (gateway callbacks, absolute image URLs)
PUBLIC_BASE_URL=http://localhost:8090
# Browser origins allowed to call the API with cookies (comma separated)
ALLOWED_ORIGINS=http://localhost:5180

# --- Security ---
# 32+ random characters in production: openssl rand -base64 48
APP_SIGNING_SECRET=dev-only-signing-secret-change-me-0123456789

# --- Email (Mailpit locally: inbox at http://localhost:8026) ---
SMTP_HOST=localhost
SMTP_PORT=1026
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_AUTH=false
SMTP_STARTTLS=false
MAIL_FROM=Practice Project <tickets@practice-project.local>

# --- Background jobs and sample data ---
JOBS_ENABLED=true
SEED_SAMPLE_DATA=true
SEED_ADMIN_PASSWORD=Admin@12345

# --- Payments ---
# Development payment simulator (no real money). Refused by the prod profile.
PAYMENT_DEV_SANDBOX_ENABLED=true

# eSewa ePay v2: defaults are eSewa's PUBLIC test merchant from https://developer.esewa.com.np
ESEWA_ENABLED=true
ESEWA_LIVE=false
ESEWA_PRODUCT_CODE=EPAYTEST
ESEWA_SECRET_KEY=8gBm/:&EnhH.1/q
ESEWA_FORM_URL=https://rc-epay.esewa.com.np/api/epay/main/v2/form
ESEWA_STATUS_URL=https://rc.esewa.com.np/api/epay/transaction/status/

# Khalti ePayment: an empty key disables Khalti. Sandbox keys: https://test-admin.khalti.com
KHALTI_SECRET_KEY=
KHALTI_LIVE=false
KHALTI_BASE_URL=https://dev.khalti.com/api/v2

# --- Movie metadata (optional): https://www.themoviedb.org/settings/api ---
TMDB_API_KEY=

# --- Integration tests (gradlew test) ---
TEST_DATABASE_URL=jdbc:postgresql://localhost:5434/practice_test
```

Never commit a `.env` file with real keys. Only the `*.env.example` templates belong in git.
