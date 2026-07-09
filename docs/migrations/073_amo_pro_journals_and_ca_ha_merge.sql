-- =============================================================================
-- Migration 073: Add AMO/PRO journals; retire duplicate CA/HA journals
--
-- The chart of journals had two pairs of duplicates: AC/HA (both "Journal
-- des achats") and CA/CS (both "Journal de caisse") — legacy imports wrote
-- directly to AC/CA while the app's own defaults seeded HA/CS. AC and CS are
-- kept as the canonical purchase/cash journals; entries on CA/HA are moved
-- onto CS/AC and the CA/HA rows are deleted by
-- backend/tools/merge_journals.py (run separately — it needs to move any
-- existing entries before the FK-referenced rows can be dropped, which plain
-- SQL can't do generically for both dev and production data).
--
-- This migration only adds the two new journals for depreciation (AMO) and
-- provisions (PRO) entries, both filed under the same "General" bucket (5)
-- as OD (Opérations diverses).
-- =============================================================================

INSERT INTO accounting_journals (uuid, code, name, type, is_active)
VALUES
  (gen_random_uuid(), 'AMO', 'Journal des amortissements', 5, TRUE),
  (gen_random_uuid(), 'PRO', 'Journal des provisions', 5, TRUE)
ON CONFLICT (code) DO NOTHING;
