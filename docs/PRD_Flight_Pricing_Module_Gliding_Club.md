# PRD — Flight Pricing Module · Gliding Club

**Version:** 0.2  
**Date:** April 2026  
**Status:** Enriched Draft  
**Context:** Supplement to the consolidated PRD — replaces section §6 / §11bis.4

---

## 1. Module Objective

To calculate, in a deterministic, reproducible, and configurable manner, the cost of a flight from the raw data transmitted by the flight board (aircraft, duration, launch type, engine time, etc.).

The result of the calculation is **frozen at the time of posting**: any subsequent modification to pricing rules does not affect an already-accounted flight.

---

## 2. Pricing Mode Taxonomy

A single flight can generate **several independent pricing lines**, combined according to the type of flight:

| Component | Applicable to | Trigger |
|---|---|---|
| **Flight hour** | Glider, TMG, Aircraft | Flight duration (decimal) |
| **Engine time** | Motor glider, TMG, Aircraft | Engine duration (1/100 h) |
| **Winch launch** | Glider (winch-launched) | Launch type + flight duration |
| **Aerotow** | Glider (aerotowed) | Tow type + tow duration |
| **Daily rate** | Any type | Number of days |
| **Per-flight fee** | Any type | Number of take-offs (fixed) |

> **Core principle:** pricing rules are **declared in the database**, never hard-coded. Any rate change is made through the admin interface, with no deployment required.

---

## 3. Common Data Structure

### 3.1 Table `pricing_items`

Represents **what is sold** (the pricing product).

```
pricing_items
├── id             UUID, PK
├── machine_id     FK → machines (nullable: global rate)
├── type           ENUM('flight_hour', 'engine_time', 'winch', 'aerotow',
│                       'daily', 'per_flight', 'subscription', 'other')
├── label          VARCHAR  -- label displayed on invoice
├── unit           VARCHAR  -- 'h', '1/100h', 'flight', 'day', etc.
├── valid_from     DATE
├── valid_until    DATE (nullable = unlimited)
└── notes          TEXT
```

### 3.2 Table `pricing_rules`

Represents the **thresholds and associated prices** for a `pricing_item`. A rule expresses: *"from threshold X onwards, the unit price is P (standard) or F (bundle/pack)"*.

```
pricing_rules
├── id              UUID, PK
├── pricing_item_id FK → pricing_items
├── qualifier       VARCHAR (nullable) -- e.g. 'Normal', 'Break', 'Ferry'
├── threshold       NUMERIC(10,4)      -- trigger threshold (in the pricing_item's unit)
├── unit_price      NUMERIC(10,4)      -- standard unit price (0 = free)
├── pack_price      NUMERIC(10,4)      -- bundle/pack unit price (nullable)
└── sort_order      INTEGER            -- rule evaluation order
```

> Rules are **evaluated in ascending `threshold` order**. The applicable rule is **the last one whose threshold is ≤ the member's cumulated consumption** over the reference period (month, season, as configured).

---

## 4. Flight Hour (Glider, TMG, Aircraft)

### 4.1 Principle

Flight-hour billing uses a **progressive threshold grid**. The price can increase or decrease based on the member's cumulated volume over the period.

The accumulation period is globally configurable (season, month, rolling 12 months).

### 4.2 Structure of a `flight_hour` rule

| Field | Value | Meaning |
|---|---|---|
| `machine_id` | `id1` | Target aircraft |
| `threshold` | `0.00` | From the very first flight |
| `unit_price` | `25.00` | Standard rate: €25/h |
| `pack_price` | `5.00` | Pack rate: €5/h |

| Field | Value | Meaning |
|---|---|---|
| `machine_id` | `id1` | Target aircraft |
| `threshold` | `5.00` | After 5 cumulated hours |
| `unit_price` | `0.00` | Standard rate: free |
| `pack_price` | `0.00` | Pack rate: free |

### 4.3 Worked example

```
Aircraft id1 — flight hour grid:
  [id1, threshold=0, price=25, pack=5]  → from 0h to 4h59: €25/h (€5/h with pack)
  [id1, threshold=5, price=0,  pack=0]  → from 5h cumulated: free

Calculation for a member with 4.5h already logged, flying 1h:
  - 0.5h at threshold=0 rule → 0.5 × 25 = €12.50
  - 0.5h at threshold=5 rule → 0.5 × 0   =  €0.00
  - Flight hour total: €12.50
```

### 4.4 Business rules

- Flight duration is expressed as a **decimal (hundredths of an hour)**, e.g. 1h30 = 1.50.
- The threshold is calculated on the **member's cumulated consumption** over the reference period, **across all aircraft sharing the same `pricing_item`** (or per aircraft, as configured).
- If `unit_price = 0` and `pack_price = 0`, the flight is **free** (e.g. complimentary flight beyond a quota).
- If `pack_price` is `NULL`, the member **does not have access to the pack rate** for this rule.
- A member without an active pack always uses `unit_price`.

---

## 5. Engine Time (Motor Glider, TMG, Aircraft)

### 5.1 Principle

Engine time is billed **independently** of flight time, in **1/100 of an hour** (hundredths). It has its own threshold grid, based on the **cumulated engine time** over the period.

### 5.2 Structure of an `engine_time` rule

| Field | Value | Meaning |
|---|---|---|
| `machine_id` | `id2` | Target aircraft |
| `threshold` | `0.00` | From the very first hundredth |
| `unit_price` | `2.50` | €2.50 per 1/100 h |

| Field | Value | Meaning |
|---|---|---|
| `machine_id` | `id2` | Target aircraft |
| `threshold` | `0.12` | After 12/100 h cumulated engine time |
| `unit_price` | `2.10` | €2.10 per 1/100 h |

### 5.3 Worked example

```
Aircraft id2 — engine time grid:
  [id2, threshold=0.00, price=2.50]  → 0 to 11/100: €2.50 per 1/100 h
  [id2, threshold=0.12, price=2.10]  → from 12/100 onwards: €2.10 per 1/100 h

Calculation for a flight of 20/100 h engine time (member at 0 cumulated):
  - 12/100 × 2.50 = €0.30
  - 8/100  × 2.10 = €0.168 → rounded to €0.17
  - Engine total: €0.47
```

### 5.4 Business rules

- Engine time is expressed in **1/100 of an hour**, e.g. 12 minutes = 0.20.
- The aircraft's engine counter is incremented on every flight.
- A flight with no engine use (engine never started) generates an engine line at **€0**.
- The accumulation period is **independent** from the flight-hour period (configurable separately).

---

## 6. Winch Launch

### 6.1 Principle

The winch is billed **per launch**, based on the **launch type** and the **duration of the resulting flight**. Two types coexist:

- **Normal**: successful launch, flight duration is exploitable
- **Break** (Casse): broken cable or failed launch — flight is not billed per hour but the launch itself is billed at a reduced rate

The price may depend on the duration of the resulting flight (progressive bracket grid).

### 6.2 Structure of `winch` rules

The `qualifier` field distinguishes the launch type.

| `machine_id` | `qualifier` | `threshold` | `unit_price` | Meaning |
|---|---|---|---|---|
| `idT` | *(null)* | `0.20` | `8.00` | Fixed winch fee from 0.20 h of flight |
| `idT` | `Normal` | `0.50` | `10.00` | Normal launch, flight < 1 h: €10 |
| `idT` | `Normal` | `1.00` | `15.00` | Normal launch, flight ≥ 1 h: €15 |
| `idT` | `Break` | `0.00` | `5.00` | Break launch, regardless of duration: €5 |

### 6.3 Evaluation algorithm

```
1. Retrieve the launch type for the flight (Normal / Break).
2. Filter winch rules for the aircraft where qualifier = launch_type OR qualifier IS NULL.
3. IS NULL rules apply first (common fixed fees).
4. Among qualified rules, select the one whose threshold (flight duration)
   is ≤ actual flight duration, with the highest threshold value.
5. The selected rule yields a FIXED price per launch (not per minute).
```

### 6.4 Worked example

```
Normal launch, flight of 1h15 (= 1.25 h):
  - NULL rule, threshold=0.20: 0.20 ≤ 1.25 → fixed fee €8
  - Normal rule, threshold=0.50: 0.50 ≤ 1.25 → applicable
  - Normal rule, threshold=1.00: 1.00 ≤ 1.25 → applicable (higher threshold → selected)
  → Winch price: €8 + €15 = €23

Break launch (failed flight, 0 h):
  - NULL rule, threshold=0.20: 0.20 > 0 → NOT applicable (flight too short)
  - Break rule, threshold=0.00: 0.00 ≤ 0 → applicable
  → Break winch price: €5
```

### 6.5 Business rules

- A break launch can generate **zero billable flight hours** but a billable winch launch fee.
- The launch type is entered on the flight board and transmitted with the flight event (`launch_type` field).
- `qualifier IS NULL` rules represent **common fees** added on top of the qualifier price.
- If no qualified rule matches (e.g. flight shorter than all qualifier thresholds), the price is **€0** for that component (excluding fixed fees).

---

## 7. Aerotow

### 7.1 Principle

The aerotow is billed **to the glider being towed**, based on the **tow type** and the **tow flight duration** (decimal). Four types are defined:

| Type | Use case |
|---|---|
| `Normal` | Standard local aerotow |
| `Ferry` (Convoyage) | Transfer of a glider to another airfield |
| `Retrieve` (Depannage) | Recovery of a glider landed out in the field |
| *(duration)* | Any duration without a specific qualifier |

### 7.2 Structure of `aerotow` rules

```
pricing_rules (type=aerotow)
  machine_id  qualifier   threshold  unit_price
  ──────────  ──────────  ─────────  ──────────
  idR         Normal      0.00       20.00    → Normal tow, fixed price per bracket
  idR         Normal      0.25       25.00    → Normal ≥ 15 min: €25
  idR         Normal      0.50       35.00    → Normal ≥ 30 min: €35
  idR         Ferry       0.00       50.00    → Ferry: €50 flat
  idR         Retrieve    0.00       80.00    → Retrieve: €80 flat
```

### 7.3 Evaluation algorithm

```
1. Retrieve the tow type (Normal / Ferry / Retrieve).
2. Filter aerotow rules for the aircraft where qualifier = tow_type.
3. Select the rule whose threshold ≤ tow flight duration,
   with the highest threshold value (same logic as winch).
4. The retained price is FIXED (not multiplied by duration).
```

> **Special case:** if the `qualifier` field is absent (NULL) in a rule, that rule applies as a common fixed fee for all tow types, added on top of the qualifier price.

### 7.4 Business rules

- The tow duration is the **tug aircraft's flight duration** (not the glider being towed).
- A `Ferry` or `Retrieve` tow may be charged to a **third-party account** (the hosting club, an external member).
- The tug aircraft simultaneously generates its own `engine_time` and `flight_hour` billing.
- Ferry / Retrieve rates may include a per-kilometre surcharge (V2).

---

## 8. Daily Rate (`daily`)

### 8.1 Principle

Some flight types or rentals generate billing **per day** rather than per hour. Typically applicable to cross-country flights or multi-day aircraft rentals.

### 8.2 Structure

```
pricing_rules (type=daily)
  machine_id  threshold  unit_price  Meaning
  ──────────  ─────────  ──────────  ───────
  idX         0          45.00       1st day: €45
  idX         3          35.00       From day 3 onwards: €35/day
```

### 8.3 Business rules

- The number of days is calculated from the **aircraft checkout date to the return date**.
- The daily rate is **stackable** with the hourly rate if both rules are active on the same aircraft.
- A flight of less than one full day counts as **1 day** (rounded up).

---

## 9. Per-flight Fee (`per_flight`)

### 9.1 Principle

A flat fee per take-off, independent of duration. Typically used for:
- Runway take-off fees (airfield landing charge)
- Introductory flight surcharge
- Administrative handling fee per flight

### 9.2 Structure

```
pricing_rules (type=per_flight)
  machine_id  qualifier  threshold  unit_price
  ──────────  ─────────  ─────────  ──────────
  idY         (null)     0          3.00      → €3 per take-off
  idY         Intro      0          10.00     → introductory flight surcharge
```

### 9.3 Business rules

- The `qualifier` can match the flight type entered on the flight board (`flight_type` field).
- With no `qualifier`, the fee applies to **all flights** for that aircraft.
- A flight cancelled before take-off (no wheel movement or cable tension) does **not** generate a `per_flight` charge.

---

## 10. Pricing Engine — General Algorithm

### 10.1 Inputs

```
Incoming flight (from flight board):
  flight_id        UUID
  machine_id       UUID
  pilot_member_id  UUID
  payer_member_id  UUID (may differ from the pilot)
  date             DATE
  duration_h       NUMERIC(6,4)   -- decimal flight duration
  engine_time_h    NUMERIC(6,4)   -- engine time (0 if not applicable)
  launch_type      ENUM('winch_normal', 'winch_break', 'aerotow_normal',
                        'aerotow_ferry', 'aerotow_retrieve', 'self')
  aerotow_duration NUMERIC(6,4)   -- tow duration (0 if not aerotowed)
  days             INTEGER        -- number of days (default: 1)
  flight_count     INTEGER        -- number of take-offs (default: 1)
  has_pack         BOOLEAN        -- does the member have an active pack?
```

### 10.2 Calculation pipeline

```
FOR each applicable component on the aircraft:

  1. FLIGHT_HOUR (if aircraft is glider/TMG/plane and duration_h > 0)
     a. Retrieve payer's cumulated hours over the reference period
     b. Evaluate flight_hour rules for the aircraft in ascending threshold order
     c. Split duration into brackets (before/after each threshold)
     d. Apply unit_price or pack_price depending on has_pack
     e. → FLIGHT_HOUR pricing line

  2. ENGINE_TIME (if engine_time_h > 0)
     a. Retrieve payer's cumulated engine time over the period
     b. Same bracket logic as FLIGHT_HOUR
     c. → ENGINE_TIME pricing line

  3. WINCH (if launch_type IN ('winch_normal', 'winch_break'))
     a. Qualifier = 'Normal' or 'Break'
     b. Evaluate IS NULL rules (fixed fees, threshold ≤ duration_h)
     c. Evaluate matching qualifier rules (threshold ≤ duration_h)
     d. Select rule with the highest threshold ≤ duration_h
     e. → WINCH pricing line (fixed price)

  4. AEROTOW (if launch_type IN ('aerotow_*'))
     a. Qualifier = 'Normal' / 'Ferry' / 'Retrieve'
     b. Same WINCH logic using aerotow_duration as the reference duration
     c. → AEROTOW pricing line (fixed price)

  5. DAILY (if a daily rule is active for the aircraft)
     a. Apply threshold grid on days
     b. → DAILY pricing line

  6. PER_FLIGHT (if a per_flight rule is active for the aircraft)
     a. Filter by qualifier if flight_type is set
     b. → PER_FLIGHT pricing line (× flight_count)

  7. ASSEMBLE lines → flight_pricing (immutable)
  8. GENERATE accounting entries
  9. NOTIFY the member (portal)
```

### 10.3 Table `flight_pricing` (frozen result)

```
flight_pricing
├── id                UUID, PK
├── flight_id         FK → flights
├── pricing_rule_id   FK → pricing_rules (rule applied)
├── component_type    ENUM (flight_hour, engine_time, winch, aerotow, daily, per_flight)
├── qualifier         VARCHAR  -- 'Normal', 'Break', etc. (snapshot)
├── quantity          NUMERIC  -- hours, days, flights
├── unit_price_used   NUMERIC  -- unit price applied (snapshot)
├── amount            NUMERIC  -- amount = quantity × unit_price_used
├── payer_member_id   FK → members
├── computed_at       TIMESTAMP
└── locked            BOOLEAN  -- true = accounting entry generated, immutable
```

> **Golden rule:** once `locked = true`, no modification is possible. A correction requires a **reversal line** (reverse entry) + a new line.

---

## 11. Full Configuration Examples

### 11.1 ASK-21 (two-seat trainer) — flight hour with season pass

```
pricing_item: machine=ASK21, type=flight_hour, label="ASK-21 Flight"
pricing_rules:
  threshold=0.00   price=28.00   pack=18.00   # standard / season pass rate
  threshold=10.00  price=25.00   pack=15.00   # degressive after 10h cumulated
  threshold=50.00  price=20.00   pack=12.00   # frequent flyer after 50h
```

### 11.2 Motor glider (DG-800) — flight hour + engine time

```
pricing_item: machine=DG800, type=flight_hour, label="DG-800 Flight"
pricing_rules:
  threshold=0.00   price=55.00   pack=null

pricing_item: machine=DG800, type=engine_time, label="DG-800 Engine"
pricing_rules:
  threshold=0.00   price=3.50    pack=null
  threshold=0.30   price=3.00    pack=null   # slight discount after 18 min engine time
```

### 11.3 Winch (single cable) — Normal + Break

```
pricing_item: machine=WINCH1, type=winch, label="Winch Launch"
pricing_rules:
  qualifier=null    threshold=0.20  price=8.00   # fixed cable fee from 12 min of flight
  qualifier=Normal  threshold=0.50  price=10.00  # flight < 30 min: €10
  qualifier=Normal  threshold=1.00  price=15.00  # flight ≥ 60 min: €15
  qualifier=Break   threshold=0.00  price=5.00   # break: €5 flat
```

### 11.4 Tug aircraft (PA-25 Pawnee) — flight hour + aerotow

```
pricing_item: machine=PA25, type=flight_hour, label="PA-25 Flight"
pricing_rules:
  threshold=0.00   price=0.00   # tug flight hours are not billed separately
                                 # (cost is absorbed into the aerotow rate)

pricing_item: machine=PA25, type=aerotow, label="Aerotow"
pricing_rules:
  qualifier=Normal   threshold=0.00  price=20.00
  qualifier=Normal   threshold=0.25  price=28.00
  qualifier=Normal   threshold=0.50  price=38.00
  qualifier=Ferry    threshold=0.00  price=60.00
  qualifier=Retrieve threshold=0.00  price=90.00
```

---

## 12. Edge Cases & Cross-Cutting Business Rules

| Case | Handling |
|---|---|
| Instruction flight (instructor on board) | `qualifier` can be `Instruction` → reduced rate if rule defined, otherwise standard rate |
| Check flight (licence test) | Same, qualifier `Check` |
| Introductory / experience flight | Qualifier `Intro` on `per_flight` → surcharge |
| Third-party billing (guest account) | `payer_member_id` ≠ `pilot_member_id` → thresholds computed on **payer's** cumulative |
| Co-ownership split (50/50) | Generates 2 `flight_pricing` lines, one per co-owner, with `quantity × 0.5` |
| Flight cancelled before take-off | `flight_pricing` not generated, flight status = `CANCELLED` |
| Duration change after entry | Not possible on a locked flight — correction via an adjustment flight |
| Pack exhausted mid-flight | Brackets exceeding the pack automatically switch to `unit_price` |

---

## 13. Pricing Administration Interface

### 13.1 Required screens

- **`pricing_items` list**: filterable by aircraft, type, validity period
- **Rule editor**: editable threshold/price table with live preview of an example case
- **Simulator**: enter a fictitious flight → display detailed line-by-line calculation
- **Audit log**: change history for rates (who, when, before/after values)
- **CSV import**: bulk loading of a rate schedule

### 13.2 Consistency checks

- Thresholds for the same `pricing_item` + `qualifier` must be **strictly increasing**.
- A `pricing_item` cannot have two active rules with the same `(qualifier, threshold)` over the same validity period.
- An alert is raised if a calculated flight exceeds a configurable **amount ceiling** (anomaly detection).

---

## 14. Open Questions Specific to Pricing

| # | Question | Impact |
|---|---|---|
| 1 | Is the accumulation period (season vs month) per member or per aircraft family? | Threshold calculation |
| 2 | Is a purchased hour pack consumed first before standard hours, or at the member's discretion? | `has_pack` logic |
| 3 | Do instruction flights automatically receive a qualifier, or is it entered manually? | Flight board integration |
| 4 | Does the tug aircraft bill its flight hours separately from the tow fee (two lines), or does only the aerotow fee appear on the glider's invoice? | Financial model |
| 5 | Are there age-differentiated rates (pilot under 25)? | Additional `qualifier` rule |
| 6 | Does the winch have a separate cost-of-ownership to track (fuel, cable maintenance)? | Machine expenses module |
| 7 | Do weekend vs weekday rates need to be managed? | Add a `day_type` field to rules |

---

*This PRD replaces and enriches sections §6 and §11bis.4 of the consolidated PRD. It should be reviewed alongside the Accounting (§5), Aircraft (§11bis.3), and Member Portal sections to ensure end-to-end consistency.*
