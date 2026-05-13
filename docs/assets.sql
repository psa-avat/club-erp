-- ERP-CLUB - Assets SQL Schema
-- Aligned with docs/SPEC_ASSETS.md and docs/SPEC_ACCOUNTING.md
-- Conventions: UUID PK, NUMERIC(10,4), SMALLINT enums, TIMESTAMPTZ audit fields

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-----------------------------------------------------------
-- Asset Types
-----------------------------------------------------------

CREATE TABLE IF NOT EXISTS asset_types (
    uuid                         UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    code                         VARCHAR(32)   NOT NULL UNIQUE,
    name                         VARCHAR(100)  NOT NULL,
    category                     SMALLINT      NOT NULL,  -- 1=Aircraft,2=LaunchEquipment,3=Support,4=Consumable,5=Service
    is_trackable_in_ledger       BOOLEAN       NOT NULL DEFAULT FALSE,
    is_active                    BOOLEAN       NOT NULL DEFAULT TRUE,
    standard_depreciation_years  INTEGER       NULL,
    created_at                   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at                   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    created_by                   INTEGER       NULL,
    updated_by                   INTEGER       NULL,
    CONSTRAINT chk_asset_types_category CHECK (category IN (1,2,3,4,5)),
    CONSTRAINT chk_asset_types_depr_years CHECK (standard_depreciation_years IS NULL OR standard_depreciation_years > 0)
);

CREATE INDEX IF NOT EXISTS ix_asset_types_category ON asset_types(category);
CREATE INDEX IF NOT EXISTS ix_asset_types_trackable ON asset_types(is_trackable_in_ledger);

-----------------------------------------------------------
-- Flight Types (per Asset Type)
-----------------------------------------------------------

CREATE TABLE IF NOT EXISTS asset_flight_types (
    uuid              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_type_uuid   UUID         NOT NULL REFERENCES asset_types(uuid) ON DELETE CASCADE,
    code              VARCHAR(32)  NOT NULL,
    name              VARCHAR(100) NOT NULL,
    description       VARCHAR(255) NULL,
    is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_asset_flight_types_code_per_type UNIQUE (asset_type_uuid, code)
);

CREATE INDEX IF NOT EXISTS ix_asset_flight_types_asset_type ON asset_flight_types(asset_type_uuid);
CREATE INDEX IF NOT EXISTS ix_asset_flight_types_active ON asset_flight_types(is_active);

-----------------------------------------------------------
-- Assets Master
-----------------------------------------------------------

CREATE TABLE IF NOT EXISTS assets (
    uuid                       UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_type_uuid            UUID           NOT NULL REFERENCES asset_types(uuid),
    code                       VARCHAR(64)    NOT NULL UNIQUE,
    name                       VARCHAR(150)   NOT NULL,
    registration               VARCHAR(32)    NULL UNIQUE,
    serial_number              VARCHAR(100)   NULL,
    manufacturer               VARCHAR(100)   NULL,
    model                      VARCHAR(100)   NULL,
    year_of_manufacture        SMALLINT       NULL,
    ownership                  SMALLINT       NOT NULL,   -- 1=Club,2=Private
    purchase_date              DATE           NULL,
    purchase_price             NUMERIC(10,4)  NULL,
    acquisition_account_uuid   UUID           NULL REFERENCES accounting_accounts(uuid),
    accounting_account_code_snapshot VARCHAR(32) NULL,
    status                     SMALLINT       NOT NULL DEFAULT 1, -- 1=Operational,2=Maintenance,3=OutOfService,4=Disposed,5=Sold
    depreciation_start_date    DATE           NULL,
    depreciation_years         SMALLINT       NULL,
    residual_value             NUMERIC(10,4)  NULL,
    useful_life_years          SMALLINT       NULL,
    notes                      TEXT           NULL,
    is_active                  BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at                 TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    created_by                 INTEGER        NULL,
    updated_by                 INTEGER        NULL,
    CONSTRAINT chk_assets_ownership CHECK (ownership IN (1,2)),
    CONSTRAINT chk_assets_status CHECK (status IN (1,2,3,4,5)),
    CONSTRAINT chk_assets_prices_positive CHECK (purchase_price IS NULL OR purchase_price >= 0),
    CONSTRAINT chk_assets_residual_positive CHECK (residual_value IS NULL OR residual_value >= 0),
    CONSTRAINT chk_assets_residual_le_purchase CHECK (
        residual_value IS NULL OR purchase_price IS NULL OR residual_value <= purchase_price
    ),
    CONSTRAINT chk_assets_depr_years CHECK (depreciation_years IS NULL OR depreciation_years > 0)
);

CREATE INDEX IF NOT EXISTS ix_assets_asset_type ON assets(asset_type_uuid);
CREATE INDEX IF NOT EXISTS ix_assets_status ON assets(status);

-----------------------------------------------------------
-- Asset Private Owners (current ownership links)
-----------------------------------------------------------

CREATE TABLE IF NOT EXISTS asset_private_owners (
    asset_uuid      UUID         NOT NULL REFERENCES assets(uuid) ON DELETE CASCADE,
    member_uuid     UUID         NOT NULL REFERENCES members(uuid) ON DELETE CASCADE,
    assigned_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    assigned_by     INTEGER      NULL REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT pk_asset_private_owners PRIMARY KEY (asset_uuid, member_uuid)
);

CREATE INDEX IF NOT EXISTS ix_asset_private_owners_member_uuid ON asset_private_owners(member_uuid);

-----------------------------------------------------------
-- Asset Account Snapshot
-----------------------------------------------------------

CREATE TABLE IF NOT EXISTS asset_account_snapshots (
    uuid            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_uuid      UUID         NOT NULL REFERENCES assets(uuid) ON DELETE CASCADE,
    account_uuid    UUID         NOT NULL REFERENCES accounting_accounts(uuid),
    account_code    VARCHAR(64)  NOT NULL,
    account_name    VARCHAR(255) NOT NULL,
    captured_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_asset_account_snapshots_asset ON asset_account_snapshots(asset_uuid);

-----------------------------------------------------------
-- Depreciation Schedules
-----------------------------------------------------------

CREATE TABLE IF NOT EXISTS asset_depreciation_schedules (
    uuid                        UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_uuid                  UUID           NOT NULL REFERENCES assets(uuid) ON DELETE CASCADE,
    fiscal_year_uuid            UUID           NOT NULL REFERENCES accounting_fiscal_years(uuid),
    depreciation_amount         NUMERIC(10,4)  NOT NULL,
    accumulated_depreciation    NUMERIC(10,4)  NOT NULL,
    net_book_value              NUMERIC(10,4)  NOT NULL,
    accounting_entry_uuid       UUID           NULL,
    status                      SMALLINT       NOT NULL DEFAULT 1, -- 1=Draft,2=Posted
    created_at                  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    created_by                  INTEGER        NULL,
    updated_by                  INTEGER        NULL,
    CONSTRAINT uq_asset_depr_asset_year UNIQUE (asset_uuid, fiscal_year_uuid),
    CONSTRAINT chk_asset_depr_status CHECK (status IN (1,2)),
    CONSTRAINT chk_asset_depr_non_negative CHECK (
        depreciation_amount >= 0 AND accumulated_depreciation >= 0 AND net_book_value >= 0
    )
);

CREATE INDEX IF NOT EXISTS ix_asset_depr_fiscal_year ON asset_depreciation_schedules(fiscal_year_uuid);
CREATE INDEX IF NOT EXISTS ix_asset_depr_status ON asset_depreciation_schedules(status);

-----------------------------------------------------------
-- Billing Metrics Catalog (shared by pricing + cost rules)
-----------------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_metrics (
    code          VARCHAR(32)   PRIMARY KEY,
    name          VARCHAR(100)  NOT NULL,
    description   VARCHAR(255)  NULL,
    is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

INSERT INTO billing_metrics(code, name, description)
VALUES
    ('engine_hours', 'Engine Hours', 'Usage measured in engine running hours'),
    ('flight_hours', 'Flight Hours', 'Usage measured in flight hours'),
    ('winch_launches', 'Winch Launches', 'Usage measured in number of winch launches'),
    ('landings', 'Landings', 'Usage measured in number of landings'),
    ('hour', 'Hour', 'Generic hourly metric for pricing items'),
    ('minute', 'Minute', 'Generic minute metric for pricing items'),
    ('flight', 'Flight', 'Generic per-flight metric for pricing items'),
    ('kilometer', 'Kilometer', 'Distance based metric for pricing items'),
    ('unit', 'Unit', 'Generic per-unit metric for pricing items'),
    ('fixed', 'Fixed', 'Flat-rate metric for pricing items')
ON CONFLICT (code) DO NOTHING;

-----------------------------------------------------------
-- Optional defaults per asset type (UX hints only)
-----------------------------------------------------------

CREATE TABLE IF NOT EXISTS asset_type_default_metrics (
    asset_type_uuid   UUID         NOT NULL REFERENCES asset_types(uuid) ON DELETE CASCADE,
    metric_code       VARCHAR(32)  NOT NULL REFERENCES billing_metrics(code),
    is_primary        BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (asset_type_uuid, metric_code)
);

CREATE INDEX IF NOT EXISTS ix_asset_type_default_metrics_primary
ON asset_type_default_metrics(asset_type_uuid)
WHERE is_primary = TRUE;

-----------------------------------------------------------
-- Cost Provision Rules
-----------------------------------------------------------

CREATE TABLE IF NOT EXISTS cost_provision_rules (
    uuid                     UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_type_uuid          UUID           NOT NULL REFERENCES asset_types(uuid),
    fiscal_year_uuid         UUID           NOT NULL REFERENCES accounting_fiscal_years(uuid),
    metric_code              VARCHAR(32)    NOT NULL REFERENCES billing_metrics(code),
    cost_per_unit            NUMERIC(10,4)  NOT NULL,
    gl_account_debit_uuid    UUID           NOT NULL REFERENCES accounting_accounts(uuid),
    gl_account_credit_uuid   UUID           NOT NULL REFERENCES accounting_accounts(uuid),
    accrual_method           SMALLINT       NOT NULL, -- 1=RealTime,2=BatchDaily,3=BatchMonthly
    is_active                BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at               TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    created_by               INTEGER        NULL,
    updated_by               INTEGER        NULL,
    CONSTRAINT chk_cost_rules_cost_per_unit CHECK (cost_per_unit > 0),
    CONSTRAINT chk_cost_rules_accrual_method CHECK (accrual_method IN (1,2,3)),
    CONSTRAINT chk_cost_rules_distinct_gl CHECK (gl_account_debit_uuid <> gl_account_credit_uuid)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cost_rules_active_unique
ON cost_provision_rules(asset_type_uuid, fiscal_year_uuid, metric_code)
WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS ix_cost_rules_fiscal_year ON cost_provision_rules(fiscal_year_uuid);
CREATE INDEX IF NOT EXISTS ix_cost_rules_asset_type ON cost_provision_rules(asset_type_uuid);

-- Compatibility migration for environments that still have metric_name.
ALTER TABLE cost_provision_rules
ADD COLUMN IF NOT EXISTS metric_code VARCHAR(32);

UPDATE cost_provision_rules
SET metric_code = CASE metric_name
    WHEN 'engine_hours' THEN 'engine_hours'
    WHEN 'winch_launches' THEN 'winch_launches'
    WHEN 'flight_hours' THEN 'flight_hours'
    WHEN 'landings' THEN 'landings'
    ELSE metric_code
END
WHERE metric_code IS NULL AND metric_name IS NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_cost_rules_metric_code'
    ) THEN
        ALTER TABLE cost_provision_rules
        ADD CONSTRAINT fk_cost_rules_metric_code
        FOREIGN KEY (metric_code) REFERENCES billing_metrics(code);
    END IF;
END $$;

DROP INDEX IF EXISTS uq_cost_rules_active_unique;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cost_rules_active_unique
ON cost_provision_rules(asset_type_uuid, fiscal_year_uuid, metric_code)
WHERE is_active = TRUE;

-----------------------------------------------------------
-- Cost Accrual Staging
-----------------------------------------------------------

CREATE TABLE IF NOT EXISTS cost_accrual_staging (
    uuid                       UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    cost_provision_rule_uuid   UUID           NOT NULL REFERENCES cost_provision_rules(uuid) ON DELETE CASCADE,
    asset_uuid                 UUID           NOT NULL REFERENCES assets(uuid) ON DELETE CASCADE,
    metric_date                DATE           NOT NULL,
    metric_value               NUMERIC(10,4)  NOT NULL,
    cost_amount                NUMERIC(10,4)  NOT NULL,
    is_accrued                 BOOLEAN        NOT NULL DEFAULT FALSE,
    accrual_entry_uuid         UUID           NULL,
    created_at                 TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_cost_staging_non_negative CHECK (metric_value >= 0 AND cost_amount >= 0)
);

CREATE INDEX IF NOT EXISTS ix_cost_staging_rule ON cost_accrual_staging(cost_provision_rule_uuid);
CREATE INDEX IF NOT EXISTS ix_cost_staging_asset ON cost_accrual_staging(asset_uuid);
CREATE INDEX IF NOT EXISTS ix_cost_staging_pending ON cost_accrual_staging(is_accrued) WHERE is_accrued = FALSE;
CREATE INDEX IF NOT EXISTS ix_cost_staging_metric_date ON cost_accrual_staging(metric_date);

-----------------------------------------------------------
-- Products And Stock
-----------------------------------------------------------

CREATE TABLE IF NOT EXISTS asset_products (
    uuid               UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    code               VARCHAR(32)    NOT NULL UNIQUE,
    name               VARCHAR(120)   NOT NULL,
    category           SMALLINT       NOT NULL, -- 1=Consumable,2=Service,3=Fee
    unit_type          VARCHAR(32)    NOT NULL,
    unit_price         NUMERIC(10,4)  NOT NULL DEFAULT 0.0000,
    asset_type_uuid    UUID           NULL REFERENCES asset_types(uuid),
    is_active          BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_asset_products_category CHECK (category IN (1,2,3)),
    CONSTRAINT chk_asset_products_price CHECK (unit_price >= 0)
);

CREATE INDEX IF NOT EXISTS ix_asset_products_asset_type ON asset_products(asset_type_uuid);

CREATE TABLE IF NOT EXISTS asset_stock_items (
    uuid                      UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_uuid              UUID           NOT NULL REFERENCES asset_products(uuid),
    asset_type_uuid           UUID           NULL REFERENCES asset_types(uuid),
    quantity_on_hand          NUMERIC(10,4)  NOT NULL DEFAULT 0.0000,
    unit                      VARCHAR(32)    NOT NULL,
    cost_method               SMALLINT       NOT NULL, -- 1=FIFO,2=WeightedAverage,3=StandardCost
    standard_cost_per_unit    NUMERIC(10,4)  NULL,
    reorder_point             NUMERIC(10,4)  NOT NULL DEFAULT 0.0000,
    storage_location          VARCHAR(100)   NULL,
    last_restocked_date       DATE           NULL,
    created_at                TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_stock_items_cost_method CHECK (cost_method IN (1,2,3)),
    CONSTRAINT chk_stock_items_non_negative CHECK (
        quantity_on_hand >= 0 AND reorder_point >= 0 AND (standard_cost_per_unit IS NULL OR standard_cost_per_unit >= 0)
    )
);

CREATE INDEX IF NOT EXISTS ix_stock_items_product ON asset_stock_items(product_uuid);
CREATE INDEX IF NOT EXISTS ix_stock_items_asset_type ON asset_stock_items(asset_type_uuid);

CREATE TABLE IF NOT EXISTS asset_stock_entries (
    uuid                  UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    stock_item_uuid       UUID           NOT NULL REFERENCES asset_stock_items(uuid) ON DELETE CASCADE,
    transaction_type      SMALLINT       NOT NULL, -- 1=Purchase,2=Issue,3=Return,4=Adjustment,5=WriteOff
    quantity_delta        NUMERIC(10,4)  NOT NULL,
    unit_cost             NUMERIC(10,4)  NULL,
    reference_document    VARCHAR(100)   NULL,
    notes                 VARCHAR(255)   NULL,
    transaction_date      DATE           NOT NULL,
    created_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    created_by            INTEGER        NULL,
    CONSTRAINT chk_stock_entries_type CHECK (transaction_type IN (1,2,3,4,5))
);

CREATE INDEX IF NOT EXISTS ix_stock_entries_item ON asset_stock_entries(stock_item_uuid);
CREATE INDEX IF NOT EXISTS ix_stock_entries_date ON asset_stock_entries(transaction_date);

-----------------------------------------------------------
-- Pricing Integration With Accounting
-----------------------------------------------------------

ALTER TABLE pricing_versions
ADD COLUMN IF NOT EXISTS asset_type_uuid UUID NULL REFERENCES asset_types(uuid);

CREATE INDEX IF NOT EXISTS ix_pricing_versions_asset_type
ON pricing_versions(asset_type_uuid);

-- Optional extension if pricing_items exists in active schema.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'pricing_items'
    ) THEN
        ALTER TABLE pricing_items ADD COLUMN IF NOT EXISTS flight_type_uuid UUID NULL REFERENCES asset_flight_types(uuid);
        ALTER TABLE pricing_items ADD COLUMN IF NOT EXISTS metric_code VARCHAR(32);

        UPDATE pricing_items
        SET metric_code = CASE unit
            WHEN 1 THEN 'hour'
            WHEN 2 THEN 'flight'
            WHEN 3 THEN 'minute'
            WHEN 4 THEN 'kilometer'
            WHEN 5 THEN 'unit'
            ELSE metric_code
        END
        WHERE metric_code IS NULL;

        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'fk_pricing_items_metric_code'
        ) THEN
            ALTER TABLE pricing_items
            ADD CONSTRAINT fk_pricing_items_metric_code
            FOREIGN KEY (metric_code) REFERENCES billing_metrics(code);
        END IF;

        CREATE INDEX IF NOT EXISTS ix_pricing_items_metric_code
        ON pricing_items(metric_code);
    END IF;
END $$;

-- Compatibility cleanup: drop legacy strategy column when present.
ALTER TABLE asset_types
DROP COLUMN IF EXISTS pricing_strategy;

-----------------------------------------------------------
-- updated_at Triggers
-- Reuses touch_updated_at() if already defined in base schema
-----------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'touch_updated_at') THEN
        DROP TRIGGER IF EXISTS trg_asset_types_updated_at ON asset_types;
        CREATE TRIGGER trg_asset_types_updated_at BEFORE UPDATE ON asset_types FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

        DROP TRIGGER IF EXISTS trg_asset_flight_types_updated_at ON asset_flight_types;
        CREATE TRIGGER trg_asset_flight_types_updated_at BEFORE UPDATE ON asset_flight_types FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

        DROP TRIGGER IF EXISTS trg_assets_updated_at ON assets;
        CREATE TRIGGER trg_assets_updated_at BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

        DROP TRIGGER IF EXISTS trg_asset_depr_updated_at ON asset_depreciation_schedules;
        CREATE TRIGGER trg_asset_depr_updated_at BEFORE UPDATE ON asset_depreciation_schedules FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

        DROP TRIGGER IF EXISTS trg_cost_rules_updated_at ON cost_provision_rules;
        CREATE TRIGGER trg_cost_rules_updated_at BEFORE UPDATE ON cost_provision_rules FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

        DROP TRIGGER IF EXISTS trg_asset_products_updated_at ON asset_products;
        CREATE TRIGGER trg_asset_products_updated_at BEFORE UPDATE ON asset_products FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

        DROP TRIGGER IF EXISTS trg_stock_items_updated_at ON asset_stock_items;
        CREATE TRIGGER trg_stock_items_updated_at BEFORE UPDATE ON asset_stock_items FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
    END IF;
END $$;
