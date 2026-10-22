-- =====================================================================
-- V4: email outbox, audit log, settings, HTTP sessions
-- =====================================================================

-- ---------------------------------------------------------------------
-- Transactional outbox for email.
--
-- Problem: if we send the confirmation email inside the booking transaction
-- and the transaction then rolls back, the customer gets an email for a
-- booking that does not exist. If we send it after commit and the app
-- crashes in between, they never get it.
-- Fix: insert a row here IN THE SAME TRANSACTION as the booking change.
-- A background job (NotificationDispatcher) sends pending rows and retries
-- failures. The email exists if and only if the booking change committed.
-- ---------------------------------------------------------------------
CREATE TABLE notifications (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    type              TEXT        NOT NULL,
    recipient         TEXT        NOT NULL,
    subject           TEXT        NOT NULL,
    body_text         TEXT        NOT NULL,
    body_html         TEXT        NOT NULL,
    status            TEXT        NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
    attempts          INT         NOT NULL DEFAULT 0,
    next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error        TEXT,
    booking_id        BIGINT      REFERENCES bookings (id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at           TIMESTAMPTZ
);
CREATE INDEX ix_notifications_due ON notifications (next_attempt_at) WHERE status = 'PENDING';

-- Who did what, for admin and money-moving actions. Append-only.
CREATE TABLE audit_events (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_user_id   BIGINT      REFERENCES users (id) ON DELETE SET NULL,
    actor_email     TEXT,
    action          TEXT        NOT NULL,
    entity_type     TEXT        NOT NULL,
    entity_id       TEXT,
    details         JSONB       NOT NULL DEFAULT '{}',
    ip_address      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_events_created ON audit_events (created_at DESC);
CREATE INDEX ix_audit_events_entity ON audit_events (entity_type, entity_id);

-- Business settings an admin can change without a deploy (fees, VAT, hold time...).
CREATE TABLE app_settings (
    key           TEXT PRIMARY KEY,
    value         JSONB       NOT NULL,
    description   TEXT        NOT NULL DEFAULT '',
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by    BIGINT      REFERENCES users (id) ON DELETE SET NULL
);

-- These values are development defaults, NOT verified tax or policy advice.
-- Confirm VAT/entertainment-tax treatment and the refund policy before go-live.
INSERT INTO app_settings (key, value, description) VALUES
    ('booking.holdMinutes',        '8',     'Minutes a seat hold lasts before the seats are released'),
    ('booking.paymentWindowMinutes', '15',  'Once payment starts, seats stay held this long while the customer is on the gateway'),
    ('booking.maxSeatsPerBooking', '10',    'Maximum seats in a single booking'),
    ('booking.salesCloseMinutes',  '10',    'Online sales close this many minutes before the show starts'),
    ('pricing.serviceFeeMinor',    '2500',  'Convenience fee per ticket, in paisa'),
    ('pricing.taxRateBasisPoints', '1300',  'Tax on (tickets - discount + fees), in basis points. 1300 = 13%'),
    ('pricing.taxLabel',           '"VAT"', 'Label shown for the tax line'),
    ('cancellation.cutoffHours',   '3',     'Customers may cancel up to this many hours before the show'),
    ('cancellation.refundPercent', '90',    'Percentage of the amount paid that is refunded on customer cancellation'),
    ('site.supportEmail',          '"support@practice-project.local"', 'Shown in emails and the footer');

-- ---------------------------------------------------------------------
-- Spring Session JDBC tables (official schema). Each logged-in browser has a
-- row here; attributes (like the security context) are serialised bytes.
-- Storing sessions in Postgres instead of app memory means a restart does not
-- log everybody out, and two app instances share one view of who is logged in.
-- ---------------------------------------------------------------------
CREATE TABLE spring_session (
    primary_id              CHAR(36)     NOT NULL,
    session_id              CHAR(36)     NOT NULL,
    creation_time           BIGINT       NOT NULL,
    last_access_time        BIGINT       NOT NULL,
    max_inactive_interval   INT          NOT NULL,
    expiry_time             BIGINT       NOT NULL,
    principal_name          VARCHAR(100),
    CONSTRAINT spring_session_pk PRIMARY KEY (primary_id)
);
CREATE UNIQUE INDEX spring_session_ix1 ON spring_session (session_id);
CREATE INDEX spring_session_ix2 ON spring_session (expiry_time);
CREATE INDEX spring_session_ix3 ON spring_session (principal_name);

CREATE TABLE spring_session_attributes (
    session_primary_id   CHAR(36)     NOT NULL,
    attribute_name       VARCHAR(200) NOT NULL,
    attribute_bytes      BYTEA        NOT NULL,
    CONSTRAINT spring_session_attributes_pk PRIMARY KEY (session_primary_id, attribute_name),
    CONSTRAINT spring_session_attributes_fk FOREIGN KEY (session_primary_id)
        REFERENCES spring_session (primary_id) ON DELETE CASCADE
);
