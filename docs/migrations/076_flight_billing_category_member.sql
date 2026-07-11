-- Migration 076: Move club/entrainement sentinel members onto flight_type_billing_accounts
--
-- Migration 075 introduced billing_category (club/entrainement/essai) but kept the
-- sentinel members (club_member_uuid/training_member_uuid) on flight_billing_settings,
-- separate from the per-category analytical accounts. In the admin UI this split the
-- "who triggers this category" (member) from "what it posts to" (accounts) across two
-- different cards, which was confusing, and gave no way to add a dedicated sentinel for
-- essai (it only inherited whichever club/training sentinel matched).
--
-- This migration merges the sentinel member into each flight_type_billing_accounts row,
-- so a category is now one self-contained record: member + analytical cost account +
-- analytical reflection account. Essai gets a real member_uuid of its own to configure,
-- and billing_category is no longer combined with a type_of_flight override — resolution
-- becomes a direct member-account_id match against these rows.

ALTER TABLE flight_type_billing_accounts
  ADD COLUMN member_uuid UUID REFERENCES members(uuid) ON DELETE SET NULL;

-- Backfill: carry over the existing sentinels onto their corresponding category row.
UPDATE flight_type_billing_accounts t
SET member_uuid = fbs.club_member_uuid
FROM flight_billing_settings fbs
WHERE t.fiscal_year_uuid = fbs.fiscal_year_uuid
  AND t.billing_category = 1  -- club
  AND fbs.club_member_uuid IS NOT NULL;

UPDATE flight_type_billing_accounts t
SET member_uuid = fbs.training_member_uuid
FROM flight_billing_settings fbs
WHERE t.fiscal_year_uuid = fbs.fiscal_year_uuid
  AND t.billing_category = 2  -- entrainement
  AND fbs.training_member_uuid IS NOT NULL;

-- The essai row (billing_category = 3) has no prior sentinel — it must be configured by
-- an admin with a dedicated member after this migration runs.

ALTER TABLE flight_billing_settings DROP COLUMN club_member_uuid;
ALTER TABLE flight_billing_settings DROP COLUMN training_member_uuid;
