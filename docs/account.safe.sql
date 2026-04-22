-- ERP-CLUB - ERP pour Club de vol a voile
-- - Logiciel libre de gestion d'un club de vol a voile
-- - accounting: non-destructive, idempotent setup/migration script
-- Copyright (C) 2026  SAFORCADA Patrick
--
-- This program is free software: you can redistribute it and/or modify
-- it under the terms of the GNU Affero General Public License as published
-- by the Free Software Foundation, either version 3 of the License, or
-- (at your option) any later version.
--
-- This program is distributed in the hope that it will be useful,
-- but WITHOUT ANY WARRANTY; without even the implied warranty of
-- MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
-- GNU Affero General Public License for more details.
--
-- You should have received a copy of the GNU Affero General Public License
-- along with this program.  If not, see <https://www.gnu.org/licenses/>.

-- account.safe.sql
-- Non-destructive and re-runnable bootstrap/migration script.
--
-- Goals:
-- 1) Never drop business tables/data.
-- 2) Create missing accounting objects.
-- 3) Patch known additive changes (new columns, indexes, triggers).

BEGIN;

-----------------------------------------------------------
-- Fiscal Years
-----------------------------------------------------------

CREATE TABLE IF NOT EXISTS accounting_fiscal_years (
    uuid          UUID          PRIMARY KEY,
    code          VARCHAR(16)   NOT NULL UNIQUE,
    label         VARCHAR(64)   NOT NULL,
    year          SMALLINT      NOT NULL UNIQUE,
    start_date    DATE          NOT NULL,
    end_date      DATE          NOT NULL,
    state         SMALLINT      NOT NULL DEFAULT 1,
    closed_at     TIMESTAMPTZ   NULL,
    closed_by     INTEGER       NULL,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_fy_dates CHECK (end_date > start_date),
    CONSTRAINT chk_fy_state CHECK (state IN (1, 2, 3))
);

-----------------------------------------------------------
-- Chart of Accounts
-----------------------------------------------------------

CREATE TABLE IF NOT EXISTS accounting_accounts (
    uuid                     UUID          PRIMARY KEY,
    code                     VARCHAR(32)   NOT NULL UNIQUE,
    name                     VARCHAR(255)  NOT NULL,
    type                     SMALLINT      NOT NULL,
    parent_account_uuid      UUID          NULL REFERENCES accounting_accounts(uuid),
    is_posting_allowed       BOOLEAN       NOT NULL DEFAULT TRUE,
    normal_balance           SMALLINT      NOT NULL,
    is_reconcilable          BOOLEAN       NOT NULL DEFAULT FALSE,
    is_active                BOOLEAN       NOT NULL DEFAULT TRUE,
    archived_at              TIMESTAMPTZ   NULL,
    replacement_account_uuid UUID          NULL REFERENCES accounting_accounts(uuid),

    CONSTRAINT chk_account_type           CHECK (type IN (1, 2, 3, 4, 5)),
    CONSTRAINT chk_account_normal_balance CHECK (normal_balance IN (1, 2))
);

-----------------------------------------------------------
-- Journals
-----------------------------------------------------------

CREATE TABLE IF NOT EXISTS accounting_journals (
    uuid                 UUID         PRIMARY KEY,
    code                 VARCHAR(10)  NOT NULL UNIQUE,
    name                 VARCHAR(100) NOT NULL,
    type                 SMALLINT     NOT NULL,
    default_account_uuid UUID         NULL REFERENCES accounting_accounts(uuid),
    is_active            BOOLEAN      NOT NULL DEFAULT TRUE,

    CONSTRAINT chk_journal_type CHECK (type IN (1, 2, 3, 4, 5, 6))
);

-----------------------------------------------------------
-- Module Global Settings
-----------------------------------------------------------

CREATE TABLE IF NOT EXISTS system_settings (
    id           BIGSERIAL      PRIMARY KEY,
    module_name  VARCHAR(64)    NOT NULL UNIQUE,
    settings     JSONB          NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_by   INTEGER        NULL
);

CREATE INDEX IF NOT EXISTS ix_system_settings_module_name
ON system_settings(module_name);

-----------------------------------------------------------
-- Pricing Versions
-----------------------------------------------------------

CREATE TABLE IF NOT EXISTS pricing_versions (
    uuid               UUID         PRIMARY KEY,
    fiscal_year_uuid   UUID         NOT NULL REFERENCES accounting_fiscal_years(uuid),
    name               VARCHAR(100) NOT NULL,
    from_date          DATE         NOT NULL,
    to_date            DATE         NULL,
    status             SMALLINT     NOT NULL DEFAULT 1,
    is_locked          BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_by         INTEGER      NULL,

    CONSTRAINT chk_pricing_version_status CHECK (status IN (1, 2, 3)),
    CONSTRAINT chk_pricing_version_dates  CHECK (to_date IS NULL OR to_date >= from_date)
);

CREATE INDEX IF NOT EXISTS ix_pricing_versions_fiscal_year
ON pricing_versions(fiscal_year_uuid);

CREATE INDEX IF NOT EXISTS ix_pricing_versions_dates
ON pricing_versions(fiscal_year_uuid, from_date, to_date);

-----------------------------------------------------------
-- Accounting Entries (partitioned)
-----------------------------------------------------------

CREATE TABLE IF NOT EXISTS accounting_entries (
    uuid                    UUID          NOT NULL,
    fiscal_year_uuid        UUID          NOT NULL REFERENCES accounting_fiscal_years(uuid),
    journal_uuid            UUID          NOT NULL REFERENCES accounting_journals(uuid),
    entry_date              DATE          NOT NULL,
    sequence_number         VARCHAR(64)   NULL,
    reference               VARCHAR(255)  NULL,
    source_document_ref     VARCHAR(255)  NULL,
    source_document_date    DATE          NULL,
    description             VARCHAR(255)  NOT NULL,
    state                   SMALLINT      NOT NULL DEFAULT 1,
    source_system           VARCHAR(64)   NULL,
    external_id             VARCHAR(255)  NULL,
    import_batch_id         VARCHAR(64)   NULL,
    original_created_at     TIMESTAMPTZ   NULL,
    original_posted_at      TIMESTAMPTZ   NULL,
    reversal_of_entry_uuid  UUID          NULL,
    reversal_reason         VARCHAR(255)  NULL,
    entry_hash              VARCHAR(64)   NULL,
    posted_at               TIMESTAMPTZ   NULL,
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    created_by              INTEGER       NOT NULL,

    CONSTRAINT pk_accounting_entries PRIMARY KEY (uuid, fiscal_year_uuid),
    CONSTRAINT chk_entry_state CHECK (state IN (1, 2, 3))
) PARTITION BY LIST (fiscal_year_uuid);

CREATE TABLE IF NOT EXISTS accounting_entries_default
    PARTITION OF accounting_entries DEFAULT;

-- Additive patch in case table predated entry_hash
ALTER TABLE accounting_entries
    ADD COLUMN IF NOT EXISTS entry_hash VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uix_entry_sequence
ON accounting_entries(fiscal_year_uuid, sequence_number)
WHERE sequence_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_entries_fiscal_year
ON accounting_entries(fiscal_year_uuid);

CREATE INDEX IF NOT EXISTS ix_entries_import_batch
ON accounting_entries(import_batch_id)
WHERE import_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_entries_external_id
ON accounting_entries(source_system, external_id)
WHERE external_id IS NOT NULL;

-----------------------------------------------------------
-- Accounting Lines (partitioned)
-----------------------------------------------------------

CREATE TABLE IF NOT EXISTS accounting_lines (
    uuid                        UUID           NOT NULL,
    fiscal_year_uuid            UUID           NOT NULL REFERENCES accounting_fiscal_years(uuid),
    entry_uuid                  UUID           NOT NULL,
    account_uuid                UUID           NOT NULL REFERENCES accounting_accounts(uuid),
    member_uuid                 UUID           NULL,
    member_account_id_snapshot  VARCHAR(32)    NULL,
    analytical_asset_uuid       UUID           NULL,
    debit                       NUMERIC(10,4)  NOT NULL DEFAULT 0.0000,
    credit                      NUMERIC(10,4)  NOT NULL DEFAULT 0.0000,
    description                 VARCHAR(255)   NULL,
    tax_id                      UUID           NULL,
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

CREATE TABLE IF NOT EXISTS accounting_lines_default
    PARTITION OF accounting_lines DEFAULT;

CREATE INDEX IF NOT EXISTS ix_lines_entry
ON accounting_lines(entry_uuid);

CREATE INDEX IF NOT EXISTS ix_lines_fiscal_year
ON accounting_lines(fiscal_year_uuid);

CREATE INDEX IF NOT EXISTS ix_lines_account
ON accounting_lines(account_uuid);

CREATE INDEX IF NOT EXISTS ix_lines_member
ON accounting_lines(member_uuid)
WHERE member_uuid IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_lines_asset
ON accounting_lines(analytical_asset_uuid)
WHERE analytical_asset_uuid IS NOT NULL;

-----------------------------------------------------------
-- Trigger function: fiscal-year boundary and posting state
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

    IF NEW.state = 2 AND fy_state NOT IN (1, 3) THEN
        RAISE EXCEPTION
            'Cannot post entry into closed fiscal year %', NEW.fiscal_year_uuid;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_entry_fiscal_year_boundary ON accounting_entries;
CREATE TRIGGER trg_entry_fiscal_year_boundary
BEFORE INSERT OR UPDATE ON accounting_entries
FOR EACH ROW EXECUTE PROCEDURE check_entry_fiscal_year_boundary();

-----------------------------------------------------------
-- Trigger function: balanced entry when posting
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

DROP TRIGGER IF EXISTS trg_check_entry_balance ON accounting_entries;
CREATE TRIGGER trg_check_entry_balance
AFTER INSERT OR UPDATE ON accounting_entries
FOR EACH ROW EXECUTE PROCEDURE check_accounting_entry_balance();

-----------------------------------------------------------
-- Trigger function: immutability of posted entries/lines
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

DROP TRIGGER IF EXISTS trg_prevent_posted_entry_update ON accounting_entries;
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

DROP TRIGGER IF EXISTS trg_prevent_posted_lines_modification ON accounting_lines;
CREATE TRIGGER trg_prevent_posted_lines_modification
BEFORE INSERT OR UPDATE OR DELETE ON accounting_lines
FOR EACH ROW EXECUTE PROCEDURE prevent_posted_line_modification();

COMMIT;
