-- Migration 018: accounting_journals additive bootstrap/patch
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS accounting_journals (
    uuid                 UUID         PRIMARY KEY,
    code                 VARCHAR(10)  NOT NULL UNIQUE,
    name                 VARCHAR(100) NOT NULL,
    type                 SMALLINT     NOT NULL,
    default_account_uuid UUID         NULL REFERENCES accounting_accounts(uuid),
    is_active            BOOLEAN      NOT NULL DEFAULT TRUE,

    CONSTRAINT chk_journal_type CHECK (type IN (1, 2, 3, 4, 5, 6, 7))
);

ALTER TABLE accounting_journals
    ADD COLUMN IF NOT EXISTS default_account_uuid UUID;

ALTER TABLE accounting_journals
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_accounting_journals_default_account'
          AND conrelid = 'accounting_journals'::regclass
    ) THEN
        ALTER TABLE accounting_journals
            ADD CONSTRAINT fk_accounting_journals_default_account
                FOREIGN KEY (default_account_uuid)
                REFERENCES accounting_accounts(uuid)
                ON DELETE SET NULL;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_journal_type'
          AND conrelid = 'accounting_journals'::regclass
    ) THEN
        ALTER TABLE accounting_journals
            ADD CONSTRAINT chk_journal_type
                CHECK (type IN (1, 2, 3, 4, 5, 6, 7));
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS ix_accounting_journals_type
    ON accounting_journals(type);

CREATE INDEX IF NOT EXISTS ix_accounting_journals_is_active
    ON accounting_journals(is_active);

-- Widen existing constraint to include type 7 (Journal des vols) if it was
-- created with the narrower range.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_journal_type'
          AND conrelid = 'accounting_journals'::regclass
    ) THEN
        ALTER TABLE accounting_journals DROP CONSTRAINT chk_journal_type;
        ALTER TABLE accounting_journals
            ADD CONSTRAINT chk_journal_type CHECK (type IN (1, 2, 3, 4, 5, 6, 7));
    END IF;
END
$$;

-- Seed default journals (idempotent).
INSERT INTO accounting_journals (uuid, code, name, type, is_active)
VALUES
    (gen_random_uuid(), 'VT', 'Journal des ventes',   1, TRUE),
    (gen_random_uuid(), 'HA', 'Journal des achats',   2, TRUE),
    (gen_random_uuid(), 'BQ', 'Journal de banque',    3, TRUE),
    (gen_random_uuid(), 'CS', 'Journal de caisse',    4, TRUE),
    (gen_random_uuid(), 'OD', 'Opérations diverses',  5, TRUE),
    (gen_random_uuid(), 'AN', 'Journal à-nouveaux',   6, TRUE),
    (gen_random_uuid(), 'FL', 'Journal des vols',     7, TRUE)
ON CONFLICT (code) DO NOTHING;