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
    pricing_strategy             SMALLINT      NOT NULL,  -- 1=FlightHours,2=EngineTime,3=PerFlight,4=PerDuration,5=PerUnit,6=FlatRate
    is_trackable_in_ledger       BOOLEAN       NOT NULL DEFAULT FALSE,
    standard_depreciation_years  INTEGER       NULL,
    created_at                   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at                   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    created_by                   INTEGER       NULL,
    updated_by                   INTEGER       NULL,
    CONSTRAINT chk_asset_types_category CHECK (category IN (1,2,3,4,5)),
    CONSTRAINT chk_asset_types_pricing_strategy CHECK (pricing_strategy IN (1,2,3,4,5,6)),
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
    serial_number              VARCHAR(100)   NULL,
    ownership                  SMALLINT       NOT NULL,   -- 1=Club,2=Private
    owner_member_uuid          UUID           NULL,       -- members.uuid (application-level FK)
    purchase_date              DATE           NULL,
    purchase_price             NUMERIC(10,4)  NULL,
    acquisition_account_uuid   UUID           NULL REFERENCES accounting_accounts(uuid),
    status                     SMALLINT       NOT NULL DEFAULT 1, -- 1=Operational,2=Maintenance,3=OutOfService,4=Disposed
    depreciation_start_date    DATE           NULL,
    depreciation_years         INTEGER        NULL,
    residual_value             NUMERIC(10,4)  NULL,
    is_active                  BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at                 TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    created_by                 INTEGER        NULL,
    updated_by                 INTEGER        NULL,
    CONSTRAINT chk_assets_ownership CHECK (ownership IN (1,2)),
    CONSTRAINT chk_assets_status CHECK (status IN (1,2,3,4)),
    CONSTRAINT chk_assets_private_owner CHECK ((ownership = 2 AND owner_member_uuid IS NOT NULL) OR ownership = 1),
    CONSTRAINT chk_assets_prices_positive CHECK (purchase_price IS NULL OR purchase_price >= 0),
    CONSTRAINT chk_assets_residual_positive CHECK (residual_value IS NULL OR residual_value >= 0),
    CONSTRAINT chk_assets_residual_le_purchase CHECK (
        residual_value IS NULL OR purchase_price IS NULL OR residual_value <= purchase_price
    ),
    CONSTRAINT chk_assets_depr_years CHECK (depreciation_years IS NULL OR depreciation_years > 0)
);

CREATE INDEX IF NOT EXISTS ix_assets_asset_type ON assets(asset_type_uuid);
CREATE INDEX IF NOT EXISTS ix_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS ix_assets_owner_member ON assets(owner_member_uuid) WHERE owner_member_uuid IS NOT NULL;

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
-- Cost Provision Rules
-----------------------------------------------------------

CREATE TABLE IF NOT EXISTS cost_provision_rules (
    uuid                     UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_type_uuid          UUID           NOT NULL REFERENCES asset_types(uuid),
    fiscal_year_uuid         UUID           NOT NULL REFERENCES accounting_fiscal_years(uuid),
    metric_name              VARCHAR(32)    NOT NULL, -- engine_hours, winch_launches, flight_hours, landings
    cost_per_unit            NUMERIC(10,4)  NOT NULL,
    gl_account_debit_uuid    UUID           NOT NULL REFERENCES accounting_accounts(uuid),
    gl_account_credit_uuid   UUID           NOT NULL REFERENCES accounting_accounts(uuid),
    accrual_method           SMALLINT       NOT NULL, -- 1=RealTime,2=BatchDaily,3=BatchMonthly
    is_active                BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at               TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    created_by               INTEGER        NULL,
    updated_by               INTEGER        NULL,
    CONSTRAINT chk_cost_rules_metric CHECK (metric_name IN ('engine_hours','winch_launches','flight_hours','landings')),
    CONSTRAINT chk_cost_rules_cost_per_unit CHECK (cost_per_unit > 0),
    CONSTRAINT chk_cost_rules_accrual_method CHECK (accrual_method IN (1,2,3)),
    CONSTRAINT chk_cost_rules_distinct_gl CHECK (gl_account_debit_uuid <> gl_account_credit_uuid)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cost_rules_active_unique
ON cost_provision_rules(asset_type_uuid, fiscal_year_uuid, metric_name)
WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS ix_cost_rules_fiscal_year ON cost_provision_rules(fiscal_year_uuid);
CREATE INDEX IF NOT EXISTS ix_cost_rules_asset_type ON cost_provision_rules(asset_type_uuid);

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
        ALTER TABLE pricing_items ADD COLUMN IF NOT EXISTS include_insurance BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE pricing_items ADD COLUMN IF NOT EXISTS include_fuel BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
END $$;

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
