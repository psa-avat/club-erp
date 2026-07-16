-- 082_carburant_fuel_types.sql
-- Correct the Carburant module's fuel types: the club only stocks 100LL and UL91,
-- not the placeholder MOGAS/JETA1 set from migration 081. type_carburant is now
-- 1=100LL, 2=UL91.

ALTER TABLE carburant_pompes
    DROP CONSTRAINT IF EXISTS chk_pompe_type_carburant;

ALTER TABLE carburant_pompes
    ADD CONSTRAINT chk_pompe_type_carburant CHECK (type_carburant IN (1, 2));
