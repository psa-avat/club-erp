-- =========================
-- EXTENSIONS
-- =========================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =========================
-- ENUMS
-- =========================
CREATE TYPE pricing_type AS ENUM (
  'flight_hour','engine_time','winch','aerotow','daily','per_flight'
);

CREATE TYPE pricing_version_status AS ENUM (
  'draft','active','archived'
);

CREATE TYPE billing_document_type AS ENUM (
  'statement','invoice'
);

CREATE TYPE billing_document_status AS ENUM (
  'draft','final'
);

-- =========================
-- CORE TABLES
-- =========================

CREATE TABLE pricing_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  valid_from DATE NOT NULL,
  valid_until DATE,
  status pricing_version_status NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  locked BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE pricing_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  version_id UUID NOT NULL REFERENCES pricing_versions(id),
  machine_id UUID,
  type pricing_type NOT NULL,
  label TEXT NOT NULL,
  unit TEXT NOT NULL,
  valid_from DATE NOT NULL,
  valid_until DATE
);

CREATE TABLE pricing_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  version_id UUID NOT NULL REFERENCES pricing_versions(id),
  pricing_item_id UUID NOT NULL REFERENCES pricing_items(id),
  qualifier TEXT,
  threshold NUMERIC(10,4) NOT NULL,
  unit_price NUMERIC(10,4) NOT NULL,
  pack_price NUMERIC(10,4),
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- =========================
-- FLIGHT PRICING OUTPUT
-- =========================

CREATE TABLE flight_pricing (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flight_id UUID NOT NULL,
  pricing_version_id UUID NOT NULL REFERENCES pricing_versions(id),
  pricing_rule_id UUID REFERENCES pricing_rules(id),

  component_type pricing_type NOT NULL,
  qualifier TEXT,

  quantity NUMERIC(10,4) NOT NULL,
  unit_price_used NUMERIC(10,4) NOT NULL,

  amount_excl_tax NUMERIC(10,2) NOT NULL,
  tax_rate NUMERIC(5,2),
  tax_amount NUMERIC(10,2),
  amount_incl_tax NUMERIC(10,2) NOT NULL,

  currency VARCHAR(3) NOT NULL DEFAULT 'EUR',

  payer_member_id UUID NOT NULL,

  computed_at TIMESTAMP NOT NULL DEFAULT now(),
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  invoiced BOOLEAN NOT NULL DEFAULT FALSE
);

-- =========================
-- BILLING (ON DEMAND)
-- =========================

CREATE TABLE billing_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id UUID NOT NULL,
  type billing_document_type NOT NULL,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  status billing_document_status NOT NULL DEFAULT 'draft'
);

CREATE TABLE billing_document_lines (
  document_id UUID REFERENCES billing_documents(id) ON DELETE CASCADE,
  flight_pricing_id UUID REFERENCES flight_pricing(id),
  amount NUMERIC(10,2) NOT NULL,
  PRIMARY KEY (document_id, flight_pricing_id)
);

-- =========================
-- PACKS / PREPAID
-- =========================

CREATE TABLE member_products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id UUID NOT NULL,
  product_type TEXT NOT NULL,
  remaining_quantity NUMERIC(10,4) NOT NULL,
  valid_until DATE
);

-- =========================
-- INDEXES (PERFORMANCE)
-- =========================

CREATE INDEX idx_pricing_rules_item ON pricing_rules(pricing_item_id);
CREATE INDEX idx_pricing_rules_threshold ON pricing_rules(pricing_item_id, threshold);

CREATE INDEX idx_flight_pricing_flight ON flight_pricing(flight_id);
CREATE INDEX idx_flight_pricing_member ON flight_pricing(payer_member_id);
CREATE INDEX idx_flight_pricing_invoiced ON flight_pricing(invoiced);

CREATE INDEX idx_billing_documents_member ON billing_documents(member_id);

-- =========================
-- CONSTRAINTS / SAFETY
-- =========================

-- Ensure only one active pricing version
CREATE UNIQUE INDEX unique_active_pricing_version
ON pricing_versions ((status))
WHERE status = 'active';