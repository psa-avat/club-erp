-- accounting.sql
-- ERP-CLUB Gliding Association ERP - Accounting Module Schema
--
-- Double-entry ledger following French PCG (Plan Comptable Général) for associations.
-- Design decisions:
--   - Fiscal year is a first-class entity; all entries carry fiscal_year_uuid explicitly.
--   - accounting_entries and accounting_lines carry fiscal_year_uuid to support
--     future PostgreSQL partitioning by fiscal year.
--   - Once an entry is Posted (state=2), it and its lines are immutable.
--   - Analytical dimension (analytical_asset_uuid) tracks costs/revenues per club asset.
--   - Member sub-ledger uses collective 411 account + member_uuid + member_account_id_snapshot.
--   - Provenance fields allow idempotent import of historical data.
--
-- Journal types  : 1=Sale, 2=Purchase, 3=Bank, 4=Cash, 5=General, 6=Opening
-- Account types  : 1=Asset, 2=Liability, 3=Equity, 4=Expense, 5=Revenue
-- Entry states   : 1=Draft, 2=Posted, 3=Cancelled
-- Fiscal yr state: 1=Open, 2=Closed, 3=Reopened
-- Normal balance : 1=Debit, 2=Credit

BEGIN;

-----------------------------------------------------------
-- Fiscal Years
-----------------------------------------------------------

CREATE TABLE accounting_fiscal_years (
    uuid          UUID          PRIMARY KEY,
    code          VARCHAR(16)   NOT NULL UNIQUE,  -- e.g. FY2026
    label         VARCHAR(64)   NOT NULL,          -- e.g. Exercice 2026
    year          SMALLINT      NOT NULL UNIQUE,
    start_date    DATE          NOT NULL,
    end_date      DATE          NOT NULL,
    state         SMALLINT      NOT NULL DEFAULT 1,
    closed_at     TIMESTAMPTZ   NULL,
    closed_by     INTEGER       NULL,              -- references users.id
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_fy_dates CHECK (end_date > start_date),
    CONSTRAINT chk_fy_state CHECK (state IN (1, 2, 3))
);

-----------------------------------------------------------
-- Chart of Accounts
-----------------------------------------------------------

CREATE TABLE accounting_accounts (
    uuid                     UUID          PRIMARY KEY,
    code                     VARCHAR(32)   NOT NULL UNIQUE,
    name                     VARCHAR(255)  NOT NULL,
    type                     SMALLINT      NOT NULL,
    parent_account_uuid      UUID          NULL REFERENCES accounting_accounts(uuid),
    is_posting_allowed       BOOLEAN       NOT NULL DEFAULT TRUE,
    normal_balance           SMALLINT      NOT NULL,   -- 1=Debit, 2=Credit
    is_reconcilable          BOOLEAN       NOT NULL DEFAULT FALSE,
    is_active                BOOLEAN       NOT NULL DEFAULT TRUE,
    archived_at              TIMESTAMPTZ   NULL,
    replacement_account_uuid UUID          NULL REFERENCES accounting_accounts(uuid),

    CONSTRAINT chk_account_type          CHECK (type IN (1, 2, 3, 4, 5)),
    CONSTRAINT chk_account_normal_balance CHECK (normal_balance IN (1, 2))
);

-----------------------------------------------------------
-- Journals
-----------------------------------------------------------

CREATE TABLE accounting_journals (
    uuid                 UUID         PRIMARY KEY,
    code                 VARCHAR(10)  NOT NULL UNIQUE,
    name                 VARCHAR(100) NOT NULL,
    type                 SMALLINT     NOT NULL,    -- 1=Sale,2=Purchase,3=Bank,4=Cash,5=General,6=Opening
    default_account_uuid UUID         NULL REFERENCES accounting_accounts(uuid),
    is_active            BOOLEAN      NOT NULL DEFAULT TRUE,

    CONSTRAINT chk_journal_type CHECK (type IN (1, 2, 3, 4, 5, 6))
);

-----------------------------------------------------------
-- Module Global Settings
-----------------------------------------------------------

CREATE TABLE system_settings (
    id           BIGSERIAL      PRIMARY KEY,
    module_name  VARCHAR(64)    NOT NULL UNIQUE,
    settings     JSONB          NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_by   INTEGER        NULL
);

CREATE INDEX ix_system_settings_module_name ON system_settings(module_name);

-----------------------------------------------------------
-- Pricing Versions (phase 2 governance)
-----------------------------------------------------------

CREATE TABLE pricing_versions (
    uuid               UUID         PRIMARY KEY,
    fiscal_year_uuid   UUID         NOT NULL REFERENCES accounting_fiscal_years(uuid),
    name               VARCHAR(100) NOT NULL,
    from_date          DATE         NOT NULL,
    to_date            DATE         NULL,
    status             SMALLINT     NOT NULL DEFAULT 1, -- 1=Draft,2=Active,3=Archived
    is_locked          BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_by         INTEGER      NULL,

    CONSTRAINT chk_pricing_version_status CHECK (status IN (1, 2, 3)),
    CONSTRAINT chk_pricing_version_dates CHECK (to_date IS NULL OR to_date >= from_date)
);

CREATE INDEX ix_pricing_versions_fiscal_year ON pricing_versions(fiscal_year_uuid);
CREATE INDEX ix_pricing_versions_dates ON pricing_versions(fiscal_year_uuid, from_date, to_date);

-----------------------------------------------------------
-- Accounting Entries (Transaction Headers)
-- Partitioned by fiscal_year_uuid (PARTITION BY LIST).
-- PK is composite (uuid, fiscal_year_uuid): PostgreSQL requires the
-- partition key to be included in every unique/primary key constraint.
-- A partition accounting_entries_<fy_code> must be created for each
-- fiscal year before entries are posted into it.
-----------------------------------------------------------

CREATE TABLE accounting_entries (
    uuid                    UUID          NOT NULL,
    fiscal_year_uuid        UUID          NOT NULL REFERENCES accounting_fiscal_years(uuid),
    journal_uuid            UUID          NOT NULL REFERENCES accounting_journals(uuid),
    entry_date              DATE          NOT NULL,
    sequence_number         VARCHAR(64)   NULL,        -- assigned on posting, immutable afterwards
    reference               VARCHAR(255)  NULL,        -- business reference shown to users
    source_document_ref     VARCHAR(255)  NULL,
    source_document_date    DATE          NULL,
    description             VARCHAR(255)  NOT NULL,
    state                   SMALLINT      NOT NULL DEFAULT 1,
    -- Provenance / import traceability
    source_system           VARCHAR(64)   NULL,
    external_id             VARCHAR(255)  NULL,
    import_batch_id         VARCHAR(64)   NULL,
    original_created_at     TIMESTAMPTZ   NULL,
    original_posted_at      TIMESTAMPTZ   NULL,
    -- Reversal chain.
    -- No DB-level FK: cross-partition self-references are not supported by PostgreSQL.
    -- Referential integrity is enforced at the application layer.
    reversal_of_entry_uuid  UUID          NULL,
    reversal_reason         VARCHAR(255)  NULL,
    -- Audit
    -- INTEGRITY CHECKSUM
    -- Stores SHA-256 hash of header + all lines (generated at Posting)
    entry_hash              VARCHAR(64)   NULL,

    posted_at               TIMESTAMPTZ   NULL,
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    created_by              INTEGER       NOT NULL,    -- references users.id

    CONSTRAINT pk_accounting_entries PRIMARY KEY (uuid, fiscal_year_uuid),
    CONSTRAINT chk_entry_state CHECK (state IN (1, 2, 3))
) PARTITION BY LIST (fiscal_year_uuid);

-- Default partition: receives rows when no year-specific partition exists yet.
CREATE TABLE accounting_entries_default PARTITION OF accounting_entries DEFAULT;

CREATE UNIQUE INDEX uix_entry_sequence ON accounting_entries(fiscal_year_uuid, sequence_number)
    WHERE sequence_number IS NOT NULL;

CREATE INDEX ix_entries_fiscal_year ON accounting_entries(fiscal_year_uuid);
CREATE INDEX ix_entries_import_batch ON accounting_entries(import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX ix_entries_external_id  ON accounting_entries(source_system, external_id) WHERE external_id IS NOT NULL;

-----------------------------------------------------------
-- Accounting Lines
-- Partitioned by fiscal_year_uuid, matching its parent entry partition.
-- FK uses composite (entry_uuid, fiscal_year_uuid) so PostgreSQL can
-- resolve it within the correct partition without cross-partition lookups.
-- The composite FK also enforces fiscal-year consistency between lines and
-- their parent entry, replacing the need for a separate trigger.
-----------------------------------------------------------

CREATE TABLE accounting_lines (
    uuid                        UUID           NOT NULL,
    fiscal_year_uuid            UUID           NOT NULL REFERENCES accounting_fiscal_years(uuid),
    entry_uuid                  UUID           NOT NULL,
    account_uuid                UUID           NOT NULL REFERENCES accounting_accounts(uuid),
    -- Member sub-ledger dimension (collective 411 control account)
    member_uuid                 UUID           NULL,   -- references members.uuid (application-layer FK)
    member_account_id_snapshot  VARCHAR(32)    NULL,   -- snapshot of members.account_id at write time
    -- Analytical dimension (cost centre per club asset)
    analytical_asset_uuid       UUID           NULL,   -- references club_assets.uuid (future table)
    -- Amounts
    debit                       NUMERIC(10,4)  NOT NULL DEFAULT 0.0000,
    credit                      NUMERIC(10,4)  NOT NULL DEFAULT 0.0000,
    description                 VARCHAR(255)   NULL,
    -- VAT snapshot (no active VAT engine in v1; preserved for import history and future readiness)
    tax_id                      UUID           NULL,   -- future tax catalog
    tax_code                    VARCHAR(64)    NULL,
    tax_rate                    NUMERIC(10,4)  NULL,
    tax_base                    NUMERIC(10,4)  NULL,
    tax_amount                  NUMERIC(10,4)  NULL,

    CONSTRAINT pk_accounting_lines          PRIMARY KEY (uuid, fiscal_year_uuid),
    CONSTRAINT fk_lines_entry               FOREIGN KEY (entry_uuid, fiscal_year_uuid)
                                                REFERENCES accounting_entries(uuid, fiscal_year_uuid)
                                                ON DELETE CASCADE,
    CONSTRAINT chk_line_amounts_positive    CHECK (debit >= 0 AND credit >= 0),
    CONSTRAINT chk_line_at_least_one_amount CHECK (debit > 0 OR credit > 0)
) PARTITION BY LIST (fiscal_year_uuid);

CREATE TABLE accounting_lines_default PARTITION OF accounting_lines DEFAULT;

CREATE INDEX ix_lines_entry        ON accounting_lines(entry_uuid);
CREATE INDEX ix_lines_fiscal_year  ON accounting_lines(fiscal_year_uuid);
CREATE INDEX ix_lines_account      ON accounting_lines(account_uuid);
CREATE INDEX ix_lines_member       ON accounting_lines(member_uuid) WHERE member_uuid IS NOT NULL;
CREATE INDEX ix_lines_asset        ON accounting_lines(analytical_asset_uuid) WHERE analytical_asset_uuid IS NOT NULL;

-----------------------------------------------------------
-- Trigger: enforce fiscal year date boundary on entries
-----------------------------------------------------------

CREATE OR REPLACE FUNCTION check_entry_fiscal_year_boundary()
RETURNS TRIGGER AS $$
DECLARE
    fy_start DATE;
    fy_end   DATE;
    fy_state SMALLINT;
BEGIN
    SELECT start_date, end_date, state
      INTO fy_start, fy_end, fy_state
      FROM accounting_fiscal_years
     WHERE uuid = NEW.fiscal_year_uuid;

    IF NEW.entry_date < fy_start OR NEW.entry_date > fy_end THEN
        RAISE EXCEPTION
            'entry_date % is outside fiscal year boundaries [%, %]',
            NEW.entry_date, fy_start, fy_end;
    END IF;

    -- Allow posting only in Open/Reopened fiscal years (1/3)
    IF NEW.state = 2 AND fy_state NOT IN (1, 3) THEN
        RAISE EXCEPTION
            'Cannot post entry into closed fiscal year %', NEW.fiscal_year_uuid;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_entry_fiscal_year_boundary
BEFORE INSERT OR UPDATE ON accounting_entries
FOR EACH ROW EXECUTE PROCEDURE check_entry_fiscal_year_boundary();

-----------------------------------------------------------
-----------------------------------------------------------
-- Trigger: enforce balanced entries on posting
-----------------------------------------------------------

CREATE OR REPLACE FUNCTION check_accounting_entry_balance()
RETURNS TRIGGER AS $$
DECLARE
    balance NUMERIC(10,4);
BEGIN
    IF NEW.state = 2 THEN
        SELECT COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0)
          INTO balance
          FROM accounting_lines
         WHERE entry_uuid = NEW.uuid;

        IF balance <> 0 THEN
            RAISE EXCEPTION
                'Accounting entry % is not balanced. Difference: %', NEW.uuid, balance;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_entry_balance
AFTER INSERT OR UPDATE ON accounting_entries
FOR EACH ROW EXECUTE PROCEDURE check_accounting_entry_balance();

-----------------------------------------------------------
-- Trigger: immutability — posted entries and their lines
-----------------------------------------------------------

CREATE OR REPLACE FUNCTION prevent_posted_entry_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.state = 2 THEN
        RAISE EXCEPTION 'Cannot modify a posted accounting entry (uuid: %)', OLD.uuid;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_posted_entry_update
BEFORE UPDATE ON accounting_entries
FOR EACH ROW EXECUTE PROCEDURE prevent_posted_entry_modification();


CREATE OR REPLACE FUNCTION prevent_posted_line_modification()
RETURNS TRIGGER AS $$
DECLARE
    entry_state SMALLINT;
BEGIN
    SELECT state INTO entry_state
      FROM accounting_entries
     WHERE uuid = COALESCE(NEW.entry_uuid, OLD.entry_uuid);

    IF entry_state = 2 THEN
        RAISE EXCEPTION 'Cannot modify lines of a posted accounting entry.';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_posted_lines_modification
BEFORE INSERT OR UPDATE OR DELETE ON accounting_lines
FOR EACH ROW EXECUTE PROCEDURE prevent_posted_line_modification();

-----------------------------------------------------------
-- Partition creation template (run once per fiscal year when opened)
-----------------------------------------------------------
-- Replace FY2026 / <fiscal_year_uuid> with the actual code and UUID.
--
-- CREATE TABLE accounting_entries_fy2026
--     PARTITION OF accounting_entries
--     FOR VALUES IN ('<fiscal_year_uuid>');
--
-- CREATE TABLE accounting_lines_fy2026
--     PARTITION OF accounting_lines
--     FOR VALUES IN ('<fiscal_year_uuid>');
--
-- Migrate any rows that landed in the default partition:
--
-- WITH moved AS (
--     DELETE FROM ONLY accounting_entries_default
--      WHERE fiscal_year_uuid = '<fiscal_year_uuid>'
--     RETURNING *
-- )
-- INSERT INTO accounting_entries SELECT * FROM moved;
--
-- WITH moved AS (
--     DELETE FROM ONLY accounting_lines_default
--      WHERE fiscal_year_uuid = '<fiscal_year_uuid>'
--     RETURNING *
-- )
-- INSERT INTO accounting_lines SELECT * FROM moved;

COMMIT;
