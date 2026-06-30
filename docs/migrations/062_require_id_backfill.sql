-- Migration 062: backfill require_id for accounts present in pcg_seed.json
-- but not covered by migration 051.
-- require_id semantics: 0=none, 1=member, 2=asset, 3=supplier (category-8 member)

-- Assets
UPDATE accounting_accounts SET require_id = 2 WHERE code = '2185';  -- Matériel de transport (Aéronefs)
UPDATE accounting_accounts SET require_id = 2 WHERE code = '6063';  -- Carburants
UPDATE accounting_accounts SET require_id = 2 WHERE code = '615';   -- Entretien et réparations
UPDATE accounting_accounts SET require_id = 2 WHERE code = '921';   -- Coûts de revient des VI

-- Suppliers
UPDATE accounting_accounts SET require_id = 3 WHERE code = '402';   -- Fournisseurs d'immobilisations
UPDATE accounting_accounts SET require_id = 3 WHERE code = '616';   -- Primes d'assurances

-- Members
UPDATE accounting_accounts SET require_id = 0 WHERE code = '419100'; -- Avances reçues — VI
UPDATE accounting_accounts SET require_id = 1 WHERE code = '487';    -- Produits constatés d'avance
UPDATE accounting_accounts SET require_id = 1 WHERE code = '6066';   -- Remises sur Packs
UPDATE accounting_accounts SET require_id = 1 WHERE code = '7066';   -- Packs et réductions
