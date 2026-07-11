-- Migration 074: Generalize club/essai flight billing accounts
--
-- Replaces the flat flight_billing_settings.club_charge_account_uuid column
-- (one account for every club-billed flight) with a per-flight-type table,
-- so club-billed flights can be routed through a type-specific analytical
-- D9xx / C902 pattern (mirroring the existing vi_type_catalog analytical
-- override) instead of always posting to a single charge account.
--
-- A NULL type_of_flight row is the generic "club default" (what
-- club_charge_account_uuid used to cover for every type); a non-NULL
-- type_of_flight (e.g. 7 = ESSAI) overrides it for that flight type only.

CREATE TABLE flight_type_billing_accounts (
  uuid                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fiscal_year_uuid                  UUID NOT NULL REFERENCES accounting_fiscal_years(uuid) ON DELETE CASCADE,
  type_of_flight                    SMALLINT,
  charge_account_uuid               UUID REFERENCES accounting_accounts(uuid) ON DELETE SET NULL,
  analytical_cost_account_uuid      UUID REFERENCES accounting_accounts(uuid) ON DELETE SET NULL,
  analytical_reflection_account_uuid UUID REFERENCES accounting_accounts(uuid) ON DELETE SET NULL,
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by                        INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- Only one generic "default" row (type_of_flight IS NULL) per fiscal year...
CREATE UNIQUE INDEX uq_flight_type_billing_accounts_default
  ON flight_type_billing_accounts (fiscal_year_uuid)
  WHERE type_of_flight IS NULL;

-- ...and only one row per specific flight type per fiscal year.
CREATE UNIQUE INDEX uq_flight_type_billing_accounts_type
  ON flight_type_billing_accounts (fiscal_year_uuid, type_of_flight)
  WHERE type_of_flight IS NOT NULL;

CREATE INDEX idx_flight_type_billing_accounts_fy ON flight_type_billing_accounts(fiscal_year_uuid);

-- Carry over the existing club_charge_account_uuid as the generic default row,
-- preserving current posting behavior. The actual account (e.g. 6064 -> 922)
-- is then reconfigured by an admin via the flight billing settings UI.
INSERT INTO flight_type_billing_accounts (fiscal_year_uuid, type_of_flight, charge_account_uuid)
SELECT fiscal_year_uuid, NULL, club_charge_account_uuid
FROM flight_billing_settings
WHERE club_charge_account_uuid IS NOT NULL;

ALTER TABLE flight_billing_settings DROP COLUMN club_charge_account_uuid;
