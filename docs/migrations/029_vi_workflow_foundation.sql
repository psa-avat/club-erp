-- ERP-CLUB - ERP pour Club de vol a voile
-- Migration 029: VI workflow data foundation
-- Copyright (C) 2026  SAFORCADA Patrick
-- SPDX-License-Identifier: AGPL-3.0-or-later

BEGIN;

CREATE TABLE IF NOT EXISTS vi_type_catalog (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT uq_vi_type_catalog_code UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS vi_entitlements (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL,
    vi_type_uuid UUID NOT NULL REFERENCES vi_type_catalog(uuid) ON DELETE RESTRICT,
    description TEXT,
    validity_date DATE,
    scheduled_date DATE,
    realisation_date DATE,
    partner_code VARCHAR(64),
    origin_type SMALLINT NOT NULL DEFAULT 4,
    origin_ref VARCHAR(128),
    notes TEXT,
    status SMALLINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT uq_vi_entitlements_code UNIQUE (code),
    CONSTRAINT chk_vi_entitlements_origin_type CHECK (origin_type BETWEEN 1 AND 5),
    CONSTRAINT chk_vi_entitlements_status CHECK (status BETWEEN 1 AND 5),
    CONSTRAINT chk_vi_entitlements_date_consistency CHECK (
        realisation_date IS NULL OR scheduled_date IS NULL OR realisation_date >= scheduled_date
    )
);

CREATE TABLE IF NOT EXISTS helloasso_vi_staging (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id BIGINT NOT NULL,
    item_id BIGINT NOT NULL,
    payment_id BIGINT NOT NULL,
    full_name VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(64),
    amount_cents INTEGER,
    campaign_type VARCHAR(64),
    form_slug VARCHAR(128),
    payment_state VARCHAR(64),
    item_state VARCHAR(64),
    purchased_at TIMESTAMPTZ,
    promoted_vi_uuid UUID NULL REFERENCES vi_entitlements(uuid) ON DELETE SET NULL,
    promoted_at TIMESTAMPTZ,
    status SMALLINT NOT NULL DEFAULT 1,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_helloasso_vi_staging_order_item_payment UNIQUE (order_id, item_id, payment_id),
    CONSTRAINT chk_helloasso_vi_staging_amount_cents CHECK (amount_cents IS NULL OR amount_cents >= 0),
    CONSTRAINT chk_helloasso_vi_staging_status CHECK (status BETWEEN 1 AND 3)
);

CREATE INDEX IF NOT EXISTS idx_vi_entitlements_vi_type_uuid ON vi_entitlements(vi_type_uuid);
CREATE INDEX IF NOT EXISTS idx_vi_entitlements_status ON vi_entitlements(status);
CREATE INDEX IF NOT EXISTS idx_vi_entitlements_validity_date ON vi_entitlements(validity_date);
CREATE INDEX IF NOT EXISTS idx_vi_entitlements_scheduled_date ON vi_entitlements(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_vi_entitlements_realisation_date ON vi_entitlements(realisation_date);
CREATE INDEX IF NOT EXISTS idx_vi_entitlements_partner_code ON vi_entitlements(partner_code);
CREATE INDEX IF NOT EXISTS idx_vi_entitlements_origin_ref ON vi_entitlements(origin_ref);

CREATE INDEX IF NOT EXISTS idx_helloasso_vi_staging_order_id ON helloasso_vi_staging(order_id);
CREATE INDEX IF NOT EXISTS idx_helloasso_vi_staging_item_id ON helloasso_vi_staging(item_id);
CREATE INDEX IF NOT EXISTS idx_helloasso_vi_staging_payment_id ON helloasso_vi_staging(payment_id);
CREATE INDEX IF NOT EXISTS idx_helloasso_vi_staging_email ON helloasso_vi_staging(email);
CREATE INDEX IF NOT EXISTS idx_helloasso_vi_staging_campaign_type ON helloasso_vi_staging(campaign_type);
CREATE INDEX IF NOT EXISTS idx_helloasso_vi_staging_form_slug ON helloasso_vi_staging(form_slug);
CREATE INDEX IF NOT EXISTS idx_helloasso_vi_staging_purchased_at ON helloasso_vi_staging(purchased_at);
CREATE INDEX IF NOT EXISTS idx_helloasso_vi_staging_promoted_vi_uuid ON helloasso_vi_staging(promoted_vi_uuid);
CREATE INDEX IF NOT EXISTS idx_helloasso_vi_staging_status ON helloasso_vi_staging(status);

INSERT INTO vi_type_catalog (code, name, description, is_active)
VALUES ('VI', 'Vol d\'initiation', 'Type de base permanent pour les vols d\'initiation', TRUE)
ON CONFLICT (code) DO NOTHING;

COMMIT;
