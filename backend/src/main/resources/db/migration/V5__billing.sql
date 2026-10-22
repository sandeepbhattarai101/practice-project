-- =====================================================================
-- V5: billing — tax invoices for confirmed bookings, credit notes for refunds
--
-- NOTE: field set and numbering are a sensible generic design, NOT a verified
-- implementation of Nepal IRD (or any other) e-billing rules. Confirm the legal
-- invoice requirements (fiscal year, PAN/VAT format, CBMS reporting) before go-live.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Gap-free numbering.
--
-- A Postgres SEQUENCE is the usual way to number things, but nextval() is NOT
-- rolled back: if a transaction takes number 41 and then fails, 41 is lost
-- forever. Tax authorities typically expect invoice numbers with no gaps.
--
-- So we keep the "next number" in a normal row and bump it with
--     UPDATE invoice_counters SET next_number = next_number + 1 ... RETURNING
-- The UPDATE row-locks the counter until our transaction ends (two invoices
-- cannot get the same number), and if the transaction rolls back, so does the
-- increment (no gap). The price: invoice creation is serialised per series,
-- which is fine at cinema-checkout volumes.
-- ---------------------------------------------------------------------
CREATE TABLE invoice_counters (
    series        TEXT   PRIMARY KEY,      -- e.g. 'INV-2026', 'CN-2026'
    next_number   BIGINT NOT NULL DEFAULT 1 CHECK (next_number > 0)
);

CREATE TABLE invoices (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_number        TEXT        NOT NULL UNIQUE,
    kind                  TEXT        NOT NULL CHECK (kind IN ('INVOICE', 'CREDIT_NOTE')),
    booking_id            BIGINT      NOT NULL REFERENCES bookings (id),
    payment_id            BIGINT      REFERENCES payments (id),
    refund_id             BIGINT      REFERENCES refunds (id),
    -- A credit note always points at the invoice it (partly) reverses.
    original_invoice_id   BIGINT      REFERENCES invoices (id),
    fiscal_year           TEXT        NOT NULL,
    issued_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Snapshot of who sold to whom AT ISSUE TIME. An invoice must never change
    -- when the customer later edits their profile or the company moves office.
    seller_name           TEXT        NOT NULL,
    seller_address        TEXT        NOT NULL,
    seller_tax_id         TEXT,
    customer_name         TEXT        NOT NULL,
    customer_email        TEXT,
    customer_phone        TEXT,
    currency              TEXT        NOT NULL,
    subtotal_minor        BIGINT      NOT NULL,
    discount_minor        BIGINT      NOT NULL DEFAULT 0,
    fee_minor             BIGINT      NOT NULL DEFAULT 0,
    tax_minor             BIGINT      NOT NULL,
    tax_rate_basis_points INT         NOT NULL,
    tax_label             TEXT        NOT NULL,
    total_minor           BIGINT      NOT NULL CHECK (total_minor >= 0),
    -- [{ "description": "...", "quantity": 2, "unitPriceMinor": 45000, "amountMinor": 90000 }]
    lines                 JSONB       NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((kind = 'CREDIT_NOTE') = (original_invoice_id IS NOT NULL)),
    CHECK (kind = 'INVOICE' OR refund_id IS NOT NULL),
    -- Totals must add up. The database refuses an inconsistent document outright.
    CHECK (total_minor = subtotal_minor - discount_minor + fee_minor + tax_minor)
);
-- Exactly one invoice per booking, and one credit note per refund.
CREATE UNIQUE INDEX ux_invoices_one_per_booking ON invoices (booking_id) WHERE kind = 'INVOICE';
CREATE UNIQUE INDEX ux_invoices_one_per_refund ON invoices (refund_id) WHERE kind = 'CREDIT_NOTE';
CREATE INDEX ix_invoices_issued ON invoices (issued_at DESC);
CREATE INDEX ix_invoices_booking ON invoices (booking_id);

-- Issued documents are immutable. Enforce it in the database, not just in Java:
-- a trigger that rejects any UPDATE or DELETE on invoices.
CREATE FUNCTION forbid_invoice_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Issued invoices are immutable; issue a credit note instead (invoice %)', OLD.invoice_number;
END;
$$;

CREATE TRIGGER trg_invoices_immutable
    BEFORE UPDATE OR DELETE ON invoices
    FOR EACH ROW EXECUTE FUNCTION forbid_invoice_changes();

INSERT INTO app_settings (key, value, description) VALUES
    ('billing.sellerName',    '"Practice Project Cinemas (sample company)"', 'Legal name printed on invoices'),
    ('billing.sellerAddress', '"Durbar Marg, Kathmandu, Nepal"',               'Registered address printed on invoices'),
    ('billing.sellerTaxId',   '"000000000"',                                   'PAN / VAT registration number (placeholder: replace before go-live)'),
    ('billing.invoicePrefix', '"PP"',                                          'Prefix for invoice and credit note numbers');
