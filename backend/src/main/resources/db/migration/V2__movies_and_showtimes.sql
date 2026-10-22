-- =====================================================================
-- V2: movies, showtimes, per-showtime pricing, promotional banners
-- =====================================================================

CREATE TABLE movies (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug              TEXT        NOT NULL UNIQUE,
    title             TEXT        NOT NULL,
    tagline           TEXT,
    synopsis          TEXT        NOT NULL DEFAULT '',
    runtime_minutes   INT         NOT NULL CHECK (runtime_minutes BETWEEN 1 AND 600),
    release_date      DATE        NOT NULL,
    certification     TEXT        NOT NULL DEFAULT 'PG',
    languages         TEXT[]      NOT NULL DEFAULT '{}',
    genres            TEXT[]      NOT NULL DEFAULT '{}',
    director          TEXT,
    -- JSONB stores structured data that is always read with the movie and
    -- never joined on: [{"name": "...", "character": "..."}]
    cast_members      JSONB       NOT NULL DEFAULT '[]',
    trailer_url       TEXT,
    poster_url        TEXT,
    backdrop_url      TEXT,
    status            TEXT        NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    is_featured       BOOLEAN     NOT NULL DEFAULT FALSE,
    tmdb_id           BIGINT UNIQUE,
    -- TRUE for rows created by the seed script. The UI shows a "development data"
    -- badge so nobody mistakes them for real listings.
    is_sample_data    BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- A GENERATED column is computed by Postgres on every insert/update, so it
    -- can never drift from the source columns. Weights: title (A) ranks above
    -- director and cast (B), which rank above synopsis (C).
    search_vector     TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(director, '')), 'B') ||
        setweight(to_tsvector('simple', coalesce(synopsis, '')), 'C')
    ) STORED
);
-- GIN indexes are built for "contains" lookups on composite values:
-- full-text vectors, arrays and JSONB.
CREATE INDEX ix_movies_search ON movies USING GIN (search_vector);
CREATE INDEX ix_movies_genres ON movies USING GIN (genres);
-- Trigram index: makes `title ILIKE '%dra%'` and similarity() fast for typeahead.
CREATE INDEX ix_movies_title_trgm ON movies USING GIN (lower(title) gin_trgm_ops);
CREATE INDEX ix_movies_status_release ON movies (status, release_date DESC);

CREATE TABLE showtimes (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    movie_id        BIGINT      NOT NULL REFERENCES movies (id),
    auditorium_id   BIGINT      NOT NULL REFERENCES auditoriums (id),
    starts_at       TIMESTAMPTZ NOT NULL,
    -- Includes cleaning/ads buffer; used for the overlap rule below.
    ends_at         TIMESTAMPTZ NOT NULL,
    format          TEXT        NOT NULL DEFAULT '2D',
    language        TEXT        NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'SCHEDULED'
                    CHECK (status IN ('SCHEDULED', 'CANCELLED')),
    sales_open      BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at),

    -- The star of this file. An EXCLUDE constraint generalises UNIQUE:
    -- "no two rows may have the same auditorium AND overlapping time ranges".
    -- Two admins scheduling clashing shows at the same moment cannot both
    -- succeed, because the database itself checks, under its own locking.
    -- Cancelled shows are ignored thanks to the WHERE clause.
    CONSTRAINT ex_showtimes_no_overlap EXCLUDE USING gist (
        auditorium_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
    ) WHERE (status = 'SCHEDULED')
);
-- Composite index matching the most common query: "shows of movie X from now on".
CREATE INDEX ix_showtimes_movie_start ON showtimes (movie_id, starts_at) WHERE status = 'SCHEDULED';
CREATE INDEX ix_showtimes_auditorium_start ON showtimes (auditorium_id, starts_at);

-- Price per seat category for each show. Money is stored as BIGINT in the
-- smallest unit (paisa), never as FLOAT: 0.1 + 0.2 != 0.3 in floating point.
CREATE TABLE showtime_prices (
    showtime_id         BIGINT NOT NULL REFERENCES showtimes (id) ON DELETE CASCADE,
    seat_category_id    BIGINT NOT NULL REFERENCES seat_categories (id),
    price_minor         BIGINT NOT NULL CHECK (price_minor >= 0),
    PRIMARY KEY (showtime_id, seat_category_id)
);

CREATE TABLE promotions (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title         TEXT        NOT NULL,
    subtitle      TEXT,
    image_url     TEXT,
    cta_label     TEXT,
    cta_url       TEXT,
    coupon_code   TEXT,
    starts_at     TIMESTAMPTZ,
    ends_at       TIMESTAMPTZ,
    is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
    sort_order    INT         NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
