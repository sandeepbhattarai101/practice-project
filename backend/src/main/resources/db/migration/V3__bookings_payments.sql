-- =====================================================================
-- V3: coupons, bookings, seat reservations, payments, refunds
--
-- Booking life cycle (enforced in BookingService, guarded here by CHECKs):
--
--   HELD ──pay──> PAYMENT_PENDING ──verified──> CONFIRMED ──cancel──> CANCELLED
--     │                 │                                                 ▲
--     └──timeout──> EXPIRED <──timeout/failed─┘     (paid too late, seats gone)
-- =====================================================================

CREATE TABLE coupons (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code                 TEXT        NOT NULL,
    description          TEXT        NOT NULL DEFAULT '',
    discount_type        TEXT        NOT NULL CHECK (discount_type IN ('PERCENT', 'FIXED')),
    -- PERCENT: basis points (1000 = 10%). FIXED: paisa.
    discount_value       BIGINT      NOT NULL CHECK (discount_value > 0),
    max_discount_minor   BIGINT      CHECK (max_discount_minor > 0),
    min_subtotal_minor   BIGINT      NOT NULL DEFAULT 0,
    valid_from           TIMESTAMPTZ,
    valid_until          TIMESTAMPTZ,
    usage_limit          INT         CHECK (usage_limit > 0),
    per_user_limit       INT         CHECK (per_user_limit > 0),
    movie_id             BIGINT      REFERENCES movies (id) ON DELETE SET NULL,
    cinema_id            BIGINT      REFERENCES cinemas (id) ON DELETE SET NULL,
    is_active            BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (discount_type <> 'PERCENT' OR discount_value <= 10000)
);
CREATE UNIQUE INDEX ux_coupons_code_upper ON coupons (upper(code));

CREATE TABLE bookings (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Short public code printed on the ticket (the id is internal).
    reference             TEXT        NOT NULL UNIQUE,
    showtime_id           BIGINT      NOT NULL REFERENCES showtimes (id),
    user_id               BIGINT      REFERENCES users (id) ON DELETE SET NULL,
    status                TEXT        NOT NULL
                          CHECK (status IN ('HELD', 'PAYMENT_PENDING', 'CONFIRMED', 'EXPIRED', 'CANCELLED')),
    customer_name         TEXT,
    customer_email        TEXT,
    customer_phone        TEXT,
    currency              TEXT        NOT NULL DEFAULT 'NPR',
    subtotal_minor        BIGINT      NOT NULL DEFAULT 0,
    discount_minor        BIGINT      NOT NULL DEFAULT 0,
    fee_minor             BIGINT      NOT NULL DEFAULT 0,
    tax_minor             BIGINT      NOT NULL DEFAULT 0,
    total_minor           BIGINT      NOT NULL DEFAULT 0,
    coupon_id             BIGINT      REFERENCES coupons (id),
    hold_expires_at       TIMESTAMPTZ NOT NULL,
    confirmed_at          TIMESTAMPTZ,
    cancelled_at          TIMESTAMPTZ,
    cancellation_reason   TEXT,
    -- Secret part of the QR code. Unique so a scanned code identifies one booking.
    ticket_code           TEXT        UNIQUE,
    checked_in_at         TIMESTAMPTZ,
    -- SHA-256 of a random token emailed to guests so they can reopen the booking.
    access_token_hash     TEXT,
    -- Optimistic locking: JPA adds "WHERE version = ?" to every UPDATE and
    -- bumps it. If someone else changed the row meanwhile, 0 rows match and the
    -- update fails instead of silently overwriting their change.
    version               BIGINT      NOT NULL DEFAULT 0,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (total_minor >= 0),
    CHECK (status <> 'CONFIRMED' OR (confirmed_at IS NOT NULL AND ticket_code IS NOT NULL))
);
CREATE INDEX ix_bookings_user ON bookings (user_id, created_at DESC);
CREATE INDEX ix_bookings_showtime ON bookings (showtime_id, status);
-- The expiry job asks "which holds have run out?" constantly; this partial
-- index contains only the rows that can still expire, so it stays tiny.
CREATE INDEX ix_bookings_hold_expiry ON bookings (hold_expires_at) WHERE status IN ('HELD', 'PAYMENT_PENDING');
CREATE INDEX ix_bookings_email ON bookings (lower(customer_email));

-- What was bought, frozen at purchase time. Prices and labels are copied so a
-- later price change or seat rename never rewrites history.
CREATE TABLE booking_items (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id      BIGINT NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
    seat_id         BIGINT NOT NULL REFERENCES seats (id),
    seat_label      TEXT   NOT NULL,
    category_name   TEXT   NOT NULL,
    price_minor     BIGINT NOT NULL CHECK (price_minor >= 0),
    UNIQUE (booking_id, seat_id)
);

-- ---------------------------------------------------------------------
-- THE double-booking guard.
--
-- One row per (show, seat) that is currently held or sold. The PRIMARY KEY
-- means Postgres physically cannot store two claims on the same seat for the
-- same show, however many requests arrive at once. SeatHoldRepository uses
-- INSERT ... ON CONFLICT to take seats, and it can only steal a row whose
-- hold has expired.
-- ---------------------------------------------------------------------
CREATE TABLE seat_reservations (
    showtime_id   BIGINT      NOT NULL REFERENCES showtimes (id) ON DELETE CASCADE,
    seat_id       BIGINT      NOT NULL REFERENCES seats (id),
    booking_id    BIGINT      NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
    status        TEXT        NOT NULL CHECK (status IN ('HELD', 'BOOKED')),
    -- NULL once BOOKED: a sold seat never expires.
    expires_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (showtime_id, seat_id),
    CHECK ((status = 'HELD') = (expires_at IS NOT NULL))
);
CREATE INDEX ix_seat_reservations_booking ON seat_reservations (booking_id);

CREATE TABLE coupon_redemptions (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    coupon_id        BIGINT      NOT NULL REFERENCES coupons (id) ON DELETE CASCADE,
    -- One coupon per booking.
    booking_id       BIGINT      NOT NULL UNIQUE REFERENCES bookings (id) ON DELETE CASCADE,
    user_id          BIGINT      REFERENCES users (id) ON DELETE SET NULL,
    customer_email   TEXT,
    -- RESERVED while the booking is unpaid, so a coupon with 1 use left cannot be
    -- applied by 50 people at once. RELEASED when the hold expires.
    status           TEXT        NOT NULL CHECK (status IN ('RESERVED', 'REDEEMED', 'RELEASED')),
    discount_minor   BIGINT      NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_coupon_redemptions_coupon ON coupon_redemptions (coupon_id) WHERE status <> 'RELEASED';

-- ---------------------------------------------------------------------
-- Payments. One booking can have several attempts (failed, then retried).
-- ---------------------------------------------------------------------
CREATE TABLE payments (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id        BIGINT      NOT NULL REFERENCES bookings (id),
    provider          TEXT        NOT NULL CHECK (provider IN ('ESEWA', 'KHALTI', 'DEV_SANDBOX')),
    status            TEXT        NOT NULL
                      CHECK (status IN ('INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED')),
    amount_minor      BIGINT      NOT NULL CHECK (amount_minor > 0),
    currency          TEXT        NOT NULL DEFAULT 'NPR',
    -- Our id as sent to the gateway (eSewa transaction_uuid / Khalti purchase_order_id).
    merchant_txn_id   TEXT        NOT NULL UNIQUE,
    -- The gateway's own id (eSewa ref_id / Khalti pidx).
    provider_txn_id   TEXT,
    -- Client-supplied key: retrying "Pay" after a network error returns the same
    -- payment instead of creating a second charge.
    idempotency_key   TEXT        NOT NULL UNIQUE,
    failure_reason    TEXT,
    completed_at      TIMESTAMPTZ,
    last_checked_at   TIMESTAMPTZ,
    check_attempts    INT         NOT NULL DEFAULT 0,
    version           BIGINT      NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_txn_id)
);
-- At most ONE successful payment per booking, guaranteed by the database.
CREATE UNIQUE INDEX ux_payments_one_success ON payments (booking_id) WHERE status = 'SUCCEEDED';
CREATE INDEX ix_payments_booking ON payments (booking_id);
CREATE INDEX ix_payments_open ON payments (created_at) WHERE status IN ('INITIATED', 'PENDING');

-- Append-only log of everything a gateway told us. Never updated, only inserted:
-- this is what you show the gateway's support team in a dispute.
CREATE TABLE payment_events (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payment_id    BIGINT      NOT NULL REFERENCES payments (id) ON DELETE CASCADE,
    event_type    TEXT        NOT NULL,
    payload       JSONB       NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_payment_events_payment ON payment_events (payment_id, created_at);

CREATE TABLE refunds (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id      BIGINT      NOT NULL REFERENCES bookings (id),
    payment_id      BIGINT      NOT NULL REFERENCES payments (id),
    amount_minor    BIGINT      NOT NULL CHECK (amount_minor >= 0),
    status          TEXT        NOT NULL CHECK (status IN ('PENDING', 'PROCESSED', 'REJECTED')),
    reason          TEXT        NOT NULL,
    provider_ref    TEXT,
    notes           TEXT,
    processed_by    BIGINT      REFERENCES users (id),
    processed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A payment is refunded at most once.
    UNIQUE (payment_id)
);
CREATE INDEX ix_refunds_status ON refunds (status, created_at);
