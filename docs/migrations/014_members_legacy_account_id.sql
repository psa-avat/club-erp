ALTER TABLE members ADD COLUMN IF NOT EXISTS legacy_account_id VARCHAR(32);

CREATE UNIQUE INDEX IF NOT EXISTS uq_members_legacy_account_id
    ON members (legacy_account_id)
    WHERE legacy_account_id IS NOT NULL;