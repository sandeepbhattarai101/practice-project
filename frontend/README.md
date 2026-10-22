# Practice Project — frontend

React 19 + TypeScript (strict) + Vite single-page app for the Practice Project cinema booking platform.
It talks only to the HTTP API described in `../docs/API.md`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on <http://localhost:5180>. `/api` is proxied to `http://localhost:8090` (the Spring Boot backend), so the app is same-origin and cookies work. |
| `npm run build` | `tsc -b` then a production build into `dist/`. |
| `npm run preview` | Serves `dist/` on port 5180. |
| `npm run test` | Vitest (jsdom) unit and component tests. |
| `npm run typecheck` | TypeScript project check without emitting. |
| `npm run lint` | ESLint (flat config). |

## Environment

Copy `.env.example` to `.env.local` if you need to override anything.

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_BASE_URL` | empty (same origin) | Base URL for API calls in deployed builds, e.g. `https://api.example.com`. The API must then allow credentialed CORS from the frontend origin, and the `XSRF-TOKEN` cookie must be readable by the frontend (same site), because the client copies it into the `X-XSRF-TOKEN` header. |

## Structure

```
src/
  app/            router, providers (boot gate, city), layouts, guards, error pages
  components/ui/  Button, Field/Input/Select, Dialog (focus trap), Confirm, Tabs, Pagination,
                  DataTable, Countdown, TagInput, Badge, Skeleton/Empty/Error states, Img, Toaster
  features/
    catalog/      home, movies, movie detail, cinemas, offers
    booking/      seat map + SSE, booking page, guest lookup
    checkout/     checkout (hold timer, coupon, customer details, payment redirect)
    billing/      printable invoice / credit note document and page
    auth/         sign in, register, password reset, email verification
    account/      profile, password, my bookings
    admin/        lazy-loaded admin area (own layout, role-guarded)
  lib/            api client, money, dates/timezones, query client, storage, ics, idempotency
  types/api.ts    types mirroring the API contract
```

## Conventions

- Money is integer paisa from the API, formatted with `formatMoney` (`Rs. 1,250`, `Rs. 1,250.50`).
- Instants are shown in the cinema's timezone, dates as DD/MM/YYYY and times as `6:30 PM`.
- The server is the source of truth for prices, availability and booking state. Client-side totals on the seat page are labelled as estimates.
- `localStorage` holds conveniences only (selected city). Payment idempotency keys live in `sessionStorage` per booking attempt.
