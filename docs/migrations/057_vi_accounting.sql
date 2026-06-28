-- Migration 057: VI accounting integration
-- Adds accounting columns to vi_type_catalog and vi_entitlements,
-- and creates the vi_flight_links join table.

-- vi_entitlements: buyer/amount/entry tracking
ALTER TABLE vi_entitlements
  ADD COLUMN amount_ttc              NUMERIC(10,4),
  ADD COLUMN buyer_member_uuid       UUID REFERENCES members(uuid) ON DELETE SET NULL,
  ADD COLUMN purchase_entry_uuid     UUID,
  ADD COLUMN realization_entry_uuid  UUID,
  ADD COLUMN registered_member_uuid  UUID REFERENCES members(uuid) ON DELETE SET NULL,
  ADD COLUMN conversion_entry_uuid   UUID;

CREATE INDEX idx_vi_ent_buyer   ON vi_entitlements(buyer_member_uuid);
CREATE INDEX idx_vi_ent_reg_mem ON vi_entitlements(registered_member_uuid);

-- vi_flight_links: one row per flight attached to an entitlement
CREATE TABLE vi_flight_links (
  uuid              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entitlement_uuid  UUID NOT NULL REFERENCES vi_entitlements(uuid) ON DELETE CASCADE,
  flight_uuid       UUID REFERENCES validated_flights(uuid) ON DELETE SET NULL,
  sequence          SMALLINT NOT NULL DEFAULT 1,
  analytical_entry_uuid UUID,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_vi_flight_link UNIQUE (entitlement_uuid, flight_uuid)
);

CREATE INDEX idx_vi_fl_entitlement ON vi_flight_links(entitlement_uuid);
CREATE INDEX idx_vi_fl_flight      ON vi_flight_links(flight_uuid);

-- vi_type_catalog: per-type accounting parameters
ALTER TABLE vi_type_catalog
  ADD COLUMN client_account_uuid                UUID REFERENCES accounting_accounts(uuid) ON DELETE SET NULL,
  ADD COLUMN revenue_account_uuid               UUID REFERENCES accounting_accounts(uuid) ON DELETE SET NULL,
  ADD COLUMN insurance_account_uuid             UUID REFERENCES accounting_accounts(uuid) ON DELETE SET NULL,
  ADD COLUMN insurance_tiers_uuid               UUID,
  ADD COLUMN insurance_amount                   NUMERIC(10,4),
  ADD COLUMN max_flights                        SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN analytical_cost_account_uuid       UUID REFERENCES accounting_accounts(uuid) ON DELETE SET NULL,
  ADD COLUMN analytical_reflection_account_uuid UUID REFERENCES accounting_accounts(uuid) ON DELETE SET NULL;

-- Backfill amount_ttc from HelloAsso staging for already-promoted entitlements
UPDATE vi_entitlements ve
SET amount_ttc = (s.amount_cents::NUMERIC / 100)
FROM helloasso_vi_staging s
WHERE s.promoted_vi_uuid = ve.uuid
  AND s.amount_cents IS NOT NULL
  AND ve.amount_ttc IS NULL;
