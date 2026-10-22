-- =====================================================================
-- V1: extensions, users, cities, cinemas, auditoriums, seats
--
-- Flyway runs files in version order (V1, V2, ...) exactly once and
-- records each in the flyway_schema_history table. Never edit a file
-- that has already run anywhere; add a new V<n> file instead.
-- =====================================================================

-- btree_gist lets an EXCLUDE constraint mix "=" on a plain column with "&&"
-- (overlaps) on a range. V2 uses it so two showtimes can never overlap in the
-- same auditorium.
CREATE EXTENSION IF NOT EXISTS btree_gist;
-- pg_trgm gives trigram similarity for "did you mean" style movie search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------
CREATE TABLE users (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email               TEXT        NOT NULL,
    password_hash       TEXT        NOT NULL,
    full_name           TEXT        NOT NULL,
    phone               TEXT,
    -- A CHECK constraint makes the database reject bad values even if
    -- application code has a bug. Enums in Java, CHECK in SQL.
    role                TEXT        NOT NULL DEFAULT 'CUSTOMER'
                        CHECK (role IN ('CUSTOMER', 'CINEMA_MANAGER', 'ADMIN')),
    status              TEXT        NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'DISABLED')),
    email_verified_at   TIMESTAMPTZ,
    preferred_city_id   BIGINT,
    marketing_opt_in    BOOLEAN     NOT NULL DEFAULT FALSE,
    failed_login_count  INT         NOT NULL DEFAULT 0,
    locked_until        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- An index on an expression: uniqueness is enforced case-insensitively, so
-- "Ram@x.com" and "ram@x.com" cannot both register.
CREATE UNIQUE INDEX ux_users_email_lower ON users (lower(email));

-- One-time tokens for email verification and password reset.
-- We store only a SHA-256 hash of the token: if the table leaks, the raw
-- tokens (which are in the emails) still cannot be reconstructed.
CREATE TABLE user_tokens (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    purpose     TEXT        NOT NULL CHECK (purpose IN ('VERIFY_EMAIL', 'RESET_PASSWORD')),
    token_hash  TEXT        NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_user_tokens_user ON user_tokens (user_id, purpose);

-- ---------------------------------------------------------------------
-- Places: city -> cinema -> auditorium -> seat
-- ---------------------------------------------------------------------
CREATE TABLE cities (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT    NOT NULL,
    slug        TEXT    NOT NULL UNIQUE,
    timezone    TEXT    NOT NULL DEFAULT 'Asia/Kathmandu',
    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order  INT     NOT NULL DEFAULT 0
);
-- A partial unique index: uniqueness applies only to rows matching WHERE.
-- Result: at most one city can be the default.
CREATE UNIQUE INDEX ux_cities_single_default ON cities (is_default) WHERE is_default;

ALTER TABLE users
    ADD CONSTRAINT fk_users_preferred_city
    FOREIGN KEY (preferred_city_id) REFERENCES cities (id) ON DELETE SET NULL;

CREATE TABLE cinemas (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    city_id         BIGINT      NOT NULL REFERENCES cities (id),
    name            TEXT        NOT NULL,
    slug            TEXT        NOT NULL UNIQUE,
    address         TEXT        NOT NULL,
    latitude        NUMERIC(9, 6),
    longitude       NUMERIC(9, 6),
    phone           TEXT,
    description     TEXT,
    -- Postgres arrays: fine for short tag lists you read together with the row.
    -- If you needed to query "cinemas with parking" a lot, a join table or a
    -- GIN index on the array would be the next step.
    facilities      TEXT[]      NOT NULL DEFAULT '{}',
    image_url       TEXT,
    status          TEXT        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_cinemas_city ON cinemas (city_id) WHERE status = 'ACTIVE';

-- Which cinemas a CINEMA_MANAGER may manage. A classic many-to-many join
-- table: the composite primary key both identifies the row and stops duplicates.
CREATE TABLE manager_cinemas (
    user_id     BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    cinema_id   BIGINT NOT NULL REFERENCES cinemas (id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, cinema_id)
);

CREATE TABLE auditoriums (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cinema_id   BIGINT      NOT NULL REFERENCES cinemas (id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    -- Formats this screen can project, e.g. {2D,3D,IMAX}.
    formats     TEXT[]      NOT NULL DEFAULT '{2D}',
    grid_rows   INT         NOT NULL CHECK (grid_rows BETWEEN 1 AND 60),
    grid_cols   INT         NOT NULL CHECK (grid_cols BETWEEN 1 AND 80),
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (cinema_id, name)
);

-- Seat categories belong to an auditorium (one hall's "Premium" is not another's).
CREATE TABLE seat_categories (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    auditorium_id   BIGINT NOT NULL REFERENCES auditoriums (id) ON DELETE CASCADE,
    code            TEXT   NOT NULL,
    name            TEXT   NOT NULL,
    color           TEXT   NOT NULL DEFAULT '#8B8B95',
    sort_order      INT    NOT NULL DEFAULT 0,
    UNIQUE (auditorium_id, code)
);

CREATE TABLE seats (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    auditorium_id   BIGINT  NOT NULL REFERENCES auditoriums (id) ON DELETE CASCADE,
    category_id     BIGINT  NOT NULL REFERENCES seat_categories (id),
    row_label       TEXT    NOT NULL,
    seat_number     INT     NOT NULL,
    -- Position on the drawn grid. Gaps (aisles) are simply grid cells with no seat.
    grid_row        INT     NOT NULL,
    grid_col        INT     NOT NULL,
    seat_type       TEXT    NOT NULL DEFAULT 'STANDARD'
                    CHECK (seat_type IN ('STANDARD', 'WHEELCHAIR', 'COMPANION', 'COUPLE')),
    -- A broken seat can be switched off without deleting it (old bookings still point at it).
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (auditorium_id, row_label, seat_number),
    UNIQUE (auditorium_id, grid_row, grid_col)
);
CREATE INDEX ix_seats_category ON seats (category_id);
