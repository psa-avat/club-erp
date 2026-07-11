-- Migration 075: Resolve club billing accounts by sentinel-member category
--
-- Migration 074 keyed flight_type_billing_accounts by type_of_flight (NULL =
-- generic club default, 7 = essai), with an optional plain class-6
-- charge_account_uuid fallback per row. In practice:
--   - Club-billed flights must always post through class-9 analytics; there is
--     no legitimate class-6 fallback for them (unlike default_initiation_charge_
--     account_uuid, which stays for genuine initiation flights without a VI type).
--   - The "generic default" row conflated two distinct real-world cases: plain
--     club errands (e.g. maintenance/ferry flights) vs. training flights ("vols
--     d'entrainement", account 922) billed to the club.
--
-- This migration replaces type_of_flight with billing_category (1=club,
-- 2=entrainement, 3=essai — see models.FlightBillingCategory), resolved from
-- which sentinel member (flight_billing_settings.club_member_uuid or the new
-- training_member_uuid) the flight's charge_to_erp_id matches, with essai
-- (TypeOfFlight.ESSAI) taking priority over either sentinel match. It also
-- drops the plain charge_account_uuid fallback column entirely.

ALTER TABLE flight_billing_settings
  ADD COLUMN training_member_uuid UUID REFERENCES members(uuid) ON DELETE SET NULL;

COMMENT ON COLUMN flight_billing_settings.training_member_uuid IS
  'Member record representing entrainement billing (detected via charge_to_erp_id), distinct from club_member_uuid';

ALTER TABLE flight_type_billing_accounts ADD COLUMN billing_category SMALLINT;

-- Backfill: the existing essai row (type_of_flight = 7) keeps its category.
UPDATE flight_type_billing_accounts SET billing_category = 3 WHERE type_of_flight = 7;

-- Backfill: the existing generic default row (type_of_flight IS NULL) was, in
-- practice, only ever configured with account 922 ("Vols d'entrainement") —
-- so it becomes the entrainement row. Any genuinely new "club" (924) row is
-- left for the admin to configure via the settings UI.
UPDATE flight_type_billing_accounts SET billing_category = 2 WHERE type_of_flight IS NULL;

ALTER TABLE flight_type_billing_accounts ALTER COLUMN billing_category SET NOT NULL;

ALTER TABLE flight_type_billing_accounts
  ADD CONSTRAINT chk_flight_type_billing_accounts_category CHECK (billing_category IN (1, 2, 3));

DROP INDEX IF EXISTS uq_flight_type_billing_accounts_default;
DROP INDEX IF EXISTS uq_flight_type_billing_accounts_type;

ALTER TABLE flight_type_billing_accounts
  ADD CONSTRAINT uq_flight_type_billing_accounts_category UNIQUE (fiscal_year_uuid, billing_category);

ALTER TABLE flight_type_billing_accounts DROP COLUMN type_of_flight;
ALTER TABLE flight_type_billing_accounts DROP COLUMN charge_account_uuid;
