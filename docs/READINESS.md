# Readiness report (22/10/2026)

What exists, what was tested and how, and what is still needed before real customers could use it. "Builds" is not the same as "production-ready"; this file keeps the difference explicit.

## Verified

| Area | Evidence |
|---|---|
| No double-selling under concurrency | `SeatHoldConcurrencyTest`: 20 simultaneous holds on one seat give exactly 1 winner; overlapping multi-seat requests never share a seat and never deadlock |
| Hold expiry and release | `SeatHoldConcurrencyTest.expiredHoldIsReleasedToTheNextCustomer`, plus the `BookingJobs` expiry job |
| Payment correctness | `BookingFlowTest`: confirmation only after the gateway check; idempotent "Pay"; duplicate callback harmless; declined → retry; late payment after resale → refund, not a double sale |
| eSewa signing | Signed form accepted by eSewa's **live UAT server** (HTTP 302); tampered signature rejected (`ES104`) |
| Coupons under concurrency | `CouponConcurrencyTest`: the last remaining use can't be taken twice |
| Auth and permissions | `AccessControlTest`: register, login, lockout, CSRF, 401/403, manager cinema scoping, role/disable takes effect immediately |
| DB-level rules | Overlapping showtime → 409 via the exclusion constraint; immutable invoices via the trigger; seat layout locked while sales exist |
| Billing | Invoice on confirmation, credit note on refund, gap-free numbering, totals CHECK |
| Real browser journeys | Playwright in Google Chrome: guest purchase end to end (ticket + QR + invoice); live seat-held update across two browsers; 13 admin pages load; phone layout has no horizontal overflow |
| Frontend units | 112 Vitest tests (money, Kathmandu time zone, seat map, checkout expiry, API client/CSRF, layout editor, forms) |
| Builds | `gradlew test` passes; `npm run typecheck`, `lint`, `test` and `build` pass |

## Integrations

| Integration | Status |
|---|---|
| PostgreSQL 16 | Real, local Docker |
| Email (SMTP) | Works locally through **Mailpit** (captured, not delivered). Needs a real SMTP provider plus SPF/DKIM for production |
| eSewa ePay v2 | Implemented and signature-verified against **UAT**. Live merchant credentials are **not available**: awaiting eSewa merchant onboarding |
| Khalti ePayment | Implemented against Khalti's documented API, **untested**: needs a sandbox key (`KHALTI_SECRET_KEY`) |
| Payment simulator | Development only; refused by the prod profile |
| TMDB | Implemented, **untested**: needs `TMDB_API_KEY` |
| QFX catalogue snapshot | Local development only (copyrighted posters/synopses, hotlinked). Not for public deployment |
| QR codes | Generated server-side (ZXing) |

## Known gaps before real customers

1. **Refund payouts are manual.** Refunds are recorded and shown in Admin → Refunds; finance pays them through the gateway's merchant portal and marks them processed. No refund API is integrated.
2. **Tax and invoice compliance is not verified.** VAT 13% on (tickets − discount + fees), the invoice fields and the numbering are sensible defaults, **not** confirmed against Nepal IRD rules (fiscal year in Bikram Sambat, CBMS real-time reporting, entertainment tax). Needs review by a tax professional.
3. **Rate limiting is per instance**, in memory. Use Redis or the proxy when running more than one instance.
4. **No CAPTCHA or bot protection** on holds or sign-up beyond rate limits and the 3-active-holds cap.
5. **No SMS/OTP.** Phone numbers are collected but not verified.
6. **No social login.**
7. **No monitoring or error tracking** wired up (Sentry, OpenTelemetry). Spring Actuator `/actuator/health` is exposed for load balancers.
8. **Accessibility** has been designed in (labels, focus states, keyboard seat map) but **not audited** with a screen reader or axe. Core Web Vitals and Lighthouse have **not been measured**.
9. **Data retention and privacy policy** are not implemented (e.g. purging old guest PII and sessions beyond Spring Session's expiry cleanup).
10. Showtimes are **sample data**; there is no integration with a real cinema scheduling system.
