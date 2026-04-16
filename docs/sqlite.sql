PRAGMA foreign_keys = ON;

-- =========================
-- PRICING VERSIONS
-- =========================

CREATE TABLE pricing_versions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  status TEXT NOT NULL CHECK(status IN ('draft','active','archived')),
  created_at TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0
);

-- =========================
-- PRICING ITEMS
-- =========================

CREATE TABLE pricing_items (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  machine_id TEXT,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  unit TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  FOREIGN KEY(version_id) REFERENCES pricing_versions(id)
);

-- =========================
-- PRICING RULES
-- =========================

CREATE TABLE pricing_rules (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  pricing_item_id TEXT NOT NULL,
  qualifier TEXT,
  threshold REAL NOT NULL,
  unit_price REAL NOT NULL,
  pack_price REAL,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY(version_id) REFERENCES pricing_versions(id),
  FOREIGN KEY(pricing_item_id) REFERENCES pricing_items(id)
);

-- =========================
-- FLIGHT PRICING
-- =========================

CREATE TABLE flight_pricing (
  id TEXT PRIMARY KEY,
  flight_id TEXT NOT NULL,
  pricing_version_id TEXT NOT NULL,
  pricing_rule_id TEXT,

  component_type TEXT NOT NULL,
  qualifier TEXT,

  quantity REAL NOT NULL,
  unit_price_used REAL NOT NULL,

  amount_excl_tax REAL NOT NULL,
  tax_rate REAL,
  tax_amount REAL,
  amount_incl_tax REAL NOT NULL,

  currency TEXT DEFAULT 'EUR',

  payer_member_id TEXT NOT NULL,

  computed_at TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0,
  invoiced INTEGER NOT NULL DEFAULT 0,

  FOREIGN KEY(pricing_version_id) REFERENCES pricing_versions(id),
  FOREIGN KEY(pricing_rule_id) REFERENCES pricing_rules(id)
);

-- =========================
-- BILLING
-- =========================

CREATE TABLE billing_documents (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  type TEXT CHECK(type IN ('statement','invoice')),
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  created_at TEXT NOT NULL,
  total_amount REAL DEFAULT 0,
  status TEXT CHECK(status IN ('draft','final'))
);

CREATE TABLE billing_document_lines (
  document_id TEXT,
  flight_pricing_id TEXT,
  amount REAL NOT NULL,
  PRIMARY KEY (document_id, flight_pricing_id),
  FOREIGN KEY(document_id) REFERENCES billing_documents(id),
  FOREIGN KEY(flight_pricing_id) REFERENCES flight_pricing(id)
);

-- =========================
-- PACKS
-- =========================

CREATE TABLE member_products (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  product_type TEXT NOT NULL,
  remaining_quantity REAL NOT NULL,
  valid_until TEXT
);

-- =========================
-- INDEXES
-- =========================

CREATE INDEX idx_pricing_rules_item ON pricing_rules(pricing_item_id);
CREATE INDEX idx_flight_pricing_member ON flight_pricing(payer_member_id);
CREATE INDEX idx_flight_pricing_invoiced ON flight_pricing(invoiced);