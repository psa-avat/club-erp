-- 081_carburant_module.sql
-- Carburant (fuel) module: pumps identified by an opaque QR token, and member-declared
-- fill-ups submitted from an unauthenticated public page. Declarations sit in "brouillon"
-- (draft) until a MANAGE_CARBURANT-capable admin validates or rejects them; only validated
-- rows count toward stock. Pump replenishments (supplier deliveries) are entered directly
-- by an admin and count toward stock immediately. This is a pure operational tracking
-- module: fuel is not sold or billed to members here, and there is no price grid or
-- accounting-entry generation.

-- ============================================================
-- 1. Pompes (pumps/tanks)
-- ============================================================
CREATE TABLE carburant_pompes (
    uuid                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nom                 VARCHAR(100) NOT NULL,
    -- 1=100LL, 2=MOGAS, 3=JETA1
    type_carburant      SMALLINT NOT NULL,
    token               VARCHAR(64) NOT NULL,
    actif               BOOLEAN NOT NULL DEFAULT true,
    capacite_cuve_l     NUMERIC(10,2),
    -- Baseline mechanical counter reading captured when the pump is onboarded, used to
    -- cross-check later index_compteur readings — not part of the stock volume calc.
    index_initial       NUMERIC(10,2),
    index_initial_date  DATE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_pompe_type_carburant CHECK (type_carburant IN (1, 2, 3)),
    CONSTRAINT chk_pompe_capacite_positive CHECK (capacite_cuve_l IS NULL OR capacite_cuve_l > 0)
);

CREATE UNIQUE INDEX uq_carburant_pompes_token ON carburant_pompes(token);

-- ============================================================
-- 2. Mouvements (declared fill-ups) — immutable journal, corrections are new rows
-- ============================================================
CREATE TABLE carburant_mouvements (
    uuid                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pompe_uuid              UUID NOT NULL REFERENCES carburant_pompes(uuid),
    asset_uuid              UUID NOT NULL REFERENCES assets(uuid),
    quantite_l              NUMERIC(8,2) NOT NULL,
    index_compteur          NUMERIC(10,2),
    -- Free-text, declarative only — captured on an unauthenticated public page, never
    -- resolved to a members row.
    membre_declarant        VARCHAR(150) NOT NULL,
    date_saisie             TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 1=brouillon, 2=valide, 3=rejete
    statut                  SMALLINT NOT NULL DEFAULT 1,
    ip_source               VARCHAR(64),
    user_agent              VARCHAR(255),
    -- Set when quantite_l exceeds the pompe's capacite_cuve_l — informational only.
    flag_anomalie           BOOLEAN NOT NULL DEFAULT false,
    commentaire_validation  TEXT,
    validated_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
    validated_at            TIMESTAMPTZ,
    CONSTRAINT chk_mvt_carburant_statut CHECK (statut IN (1, 2, 3)),
    CONSTRAINT chk_mvt_carburant_quantite_positive CHECK (quantite_l > 0)
);

CREATE INDEX idx_carburant_mouvements_pompe ON carburant_mouvements(pompe_uuid);
CREATE INDEX idx_carburant_mouvements_asset ON carburant_mouvements(asset_uuid);
CREATE INDEX idx_carburant_mouvements_statut ON carburant_mouvements(statut);
-- Backs the per-pompe/per-IP submission throttle (most recent movement for a given pompe+IP).
CREATE INDEX idx_carburant_mouvements_pompe_ip_date ON carburant_mouvements(pompe_uuid, ip_source, date_saisie);

-- ============================================================
-- 3. Ravitaillements (pump/tank replenishments) — admin-entered, count toward stock
-- immediately (no brouillon/valide/rejete workflow, unlike carburant_mouvements)
-- ============================================================
CREATE TABLE carburant_ravitaillements (
    uuid                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pompe_uuid           UUID NOT NULL REFERENCES carburant_pompes(uuid),
    quantite_l           NUMERIC(10,2) NOT NULL,
    date_ravitaillement  DATE NOT NULL,
    note                 TEXT,
    created_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_ravitaillement_quantite_positive CHECK (quantite_l > 0)
);

CREATE INDEX idx_carburant_ravitaillements_pompe ON carburant_ravitaillements(pompe_uuid);
