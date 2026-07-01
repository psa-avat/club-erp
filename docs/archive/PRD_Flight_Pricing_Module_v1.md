# PRD — Flight Pricing Module · Gliding Club

**Version:** 1.0  
**Date:** April 2026  
**Status:** Production-ready draft  
**Scope:** Pricing engine, pricing configuration, and billing extraction  
**Replaces:** Previous version 0.2 (§6 / §11bis.4)

---

# 1. Module Objective

The Flight Pricing Module computes the **monetary cost of a flight** from raw operational data (flight board).

## Key properties

- Deterministic: same inputs → same result  
- Reproducible: pricing tied to a version  
- Immutable: once posted, results cannot be modified  
- Configurable: all pricing rules stored in database  

> **Golden Rule**: A priced flight is never modified. Corrections are handled via reversal entries.

---

# 2. Pricing Versioning

## 2.1 Principle

All pricing rules belong to a **versioned pricing configuration**.

A flight is always computed using **one and only one pricing version**.

---

## 2.2 Table `pricing_versions`

```
pricing_versions
├── id             UUID, PK
├── name           VARCHAR        -- "2026 Season"
├── valid_from     DATE
├── valid_until    DATE (nullable)
├── status         ENUM('draft','active','archived')
├── created_at     TIMESTAMP
├── locked         BOOLEAN
```

### Rules

- Only **one version is active** at a time  
- A version becomes **immutable once activated**  
- Historical versions remain accessible  

---

## 2.3 Version linkage

```
pricing_items.version_id     FK → pricing_versions
pricing_rules.version_id     FK → pricing_versions
flight_pricing.version_id    FK → pricing_versions
```

---

# 3. Pricing Model Overview

A single flight generates **multiple pricing components**:

| Component | Trigger |
|----------|--------|
| Flight hour | Flight duration |
| Engine time | Engine usage |
| Winch | Launch type |
| Aerotow | Tow type + duration |
| Daily | Number of days |
| Per-flight | Number of take-offs |

Each component produces **independent pricing lines**.

---

# 4. Core Data Model

## 4.1 Table `pricing_items`

Defines *what is billed*.

```
pricing_items
├── id
├── version_id
├── machine_id     (nullable)
├── type           ENUM(...)
├── label
├── unit
├── valid_from
├── valid_until
```

---

## 4.2 Table `pricing_rules`

Defines *how it is priced*.

```
pricing_rules
├── id
├── version_id
├── pricing_item_id
├── qualifier      VARCHAR (nullable)
├── threshold      NUMERIC(10,4)
├── unit_price     NUMERIC(10,4)
├── pack_price     NUMERIC(10,4) NULL
├── sort_order
```

---

## 4.3 Rule evaluation principle

- Rules are ordered by **threshold ascending**
- Applicable rule = **highest threshold ≤ consumption**

---

# 5. Monetary Precision & Rounding

## 5.1 Internal precision

- Quantities and prices stored with **4 decimal places**
- Calculations performed at high precision

---

## 5.2 Rounding rule

All monetary values use:

**ROUND_HALF_UP to 2 decimals**

---

## 5.3 Line calculation

```
amount = ROUND(quantity × unit_price, 2)
```

---

## 5.4 Aggregation rule

```
total = SUM(rounded line amounts)
```

---

## 5.5 Bracket splitting

Each bracket is calculated and rounded independently.

---

# 6. Flight Hour Pricing

- Progressive threshold grid  
- Based on member cumulative usage  
- Supports pack pricing  

## Rules

- Duration in decimal hours  
- Threshold based on payer consumption  
- Pack used if available  

---

# 7. Engine Time Pricing

- Independent from flight hours  
- Unit: 1/100 hour  
- Own threshold grid  

---

# 8. Winch Pricing

- Fixed price per launch  
- Based on:
  - launch type (`Normal`, `Break`)
  - flight duration  

## Evaluation

1. Apply common rules (`qualifier IS NULL`)
2. Apply qualifier rules
3. Select highest threshold ≤ duration
4. Sum fixed fees

---

# 9. Aerotow Pricing

- Fixed price per tow  
- Based on:
  - tow type (`Normal`, `Ferry`, `Retrieve`)
  - tow duration  

Same logic as winch.

---

# 10. Daily Pricing

- Based on number of days  
- Progressive thresholds supported  

---

# 11. Per-flight Pricing

- Flat fee per take-off  
- Optional qualifier  

---

# 12. Pricing Engine

## 12.1 Processing pipeline

1. Load active pricing version  
2. Retrieve pricing items + rules  
3. Compute components  
4. Apply rounding  
5. Store results  

---

## 12.2 Table `flight_pricing`

```
flight_pricing
├── id
├── flight_id
├── pricing_version_id
├── pricing_rule_id
├── component_type
├── qualifier
├── quantity
├── unit_price_used
├── amount_excl_tax
├── tax_rate        NULL
├── tax_amount      NULL
├── amount_incl_tax
├── currency        DEFAULT 'EUR'
├── payer_member_id
├── computed_at
├── locked
├── invoiced        BOOLEAN DEFAULT FALSE
```

---

## 12.3 Immutability

- `locked = true` → no update  
- Corrections = reversal entries  

---

# 13. Billing Model (On-Demand)

## 13.1 Principle

- Flights priced continuously  
- Billing documents optional  
- No invoice per flight  

---

## 13.2 Table `billing_documents`

```
billing_documents
├── id
├── member_id
├── type           ENUM('statement','invoice')
├── period_from
├── period_to
├── created_at
├── total_amount
├── status         ENUM('draft','final')
```

---

## 13.3 Table `billing_document_lines`

```
billing_document_lines
├── document_id
├── flight_pricing_id
├── amount
```

---

## 13.4 Workflow

### Default
- Member sees statement

### Invoice (on request)
1. Select period  
2. Retrieve non-invoiced lines  
3. Generate document  
4. Mark as invoiced  

---

# 14. Packs & Prepaid Products

## 14.1 Table `member_products`

```
member_products
├── id
├── member_id
├── product_type
├── remaining_quantity
├── valid_until
```

---

## Rules

- Pack consumed first  
- If exhausted → switch to standard pricing  

---

# 15. Edge Cases

| Case | Handling |
|-----|--------|
| Third-party payer | thresholds use payer |
| Co-ownership | split lines |
| Cancelled flight | no pricing |
| Correction | reversal entry |
| Pack exhaustion | automatic switch |
| Zero engine | €0 line |

---

# 16. Administration Interface

## Features

- Pricing version management  
- Rule editor  
- Simulator  
- Audit log  
- CSV import  

---

## Checks

- Increasing thresholds  
- No duplicate rules  
- Pricing anomaly alerts  

---

# 17. Non-Functional Requirements

## Performance

- Use pre-aggregation  
- Target: <100 ms per pricing  

---

## Security

- Role-based access  

---

## Audit

- Full traceability of pricing  

---

# 18. Future Extensions

- VAT activation  
- Advanced rule conditions  
- Fleet cost tracking  
- Accounting export  

---

# Final Note

This design provides:

- Robust accounting foundation  
- Flexible pricing engine  
- Lightweight operations  
- Future scalability  
