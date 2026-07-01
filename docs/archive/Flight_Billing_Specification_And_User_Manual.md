# Flight Billing & Pack Management: Unified Core Specification & User Manual

This document provides a single, cohesive source of truth for the Gliding Club ERP Flights Billing module. It synthesizes the authoritative **Implementation Plan** with relevant constraints from legacy specifications (`compta.md`, `SPEC_FLIGHTS_BILLING.md`) and introduces a comprehensive Operational User Manual along with a professional UX/UI cockpit design blueprint.

---

## Part 1: Strategic Consistency & Alignment Analysis

Following an audit of the uploaded specifications against the **Implementation Plan (Authoritative Reference)**, the following architectural alignments and historical reconciliation points have been established:

### 1.1 Decoupled Discount Realization (Fully Aligned)
All documents cleanly align on a **"Preview-First, Gross-Billed"** ledger architecture. Flights are strictly recorded at standard gross rates in the **Flights (`FL`) Journal** (Debit `411xxx` Member $\rightarrow$ Credit `706xxx` Flight Revenue). Pack discounts are tracked purely as operational consumption vectors and settled via a dedicated **Adjustment (`REM`) Journal** (Debit `608xxx` Pack Discount Expense $\rightarrow$ Credit `411xxx` Member). This guarantees an unpolluted, auditable gross revenue stream.

### 1.2 Reconciliation of the 7-Day Soft Window (Overridden)
* **Legacy Spec (`compta.md` §17):** Proposed an open functional question regarding a *"7-day tolerance window for post-flight pack purchases."*
* **Finalized Plan Boundary:** The **Post-Purchase Recalculation Engine** completely deprecates this time-box. Members can purchase a pack *at any point* within the active **Fiscal Year**. The engine retroactively loops through unposted or unadjusted flights within that year to apply the pack benefits, ensuring high customer satisfaction and matching non-profit club operational rhythms.

### 1.3 Journal Codes Standardization (Normalized)
* **Legacy Spec (`SPEC_FLIGHTS_BILLING.md` §2.7):** Varied terminology between `REM` and `DISC` codes.
* **Finalized Plan Boundary:** The journal code is strictly locked to **`REM`** for all periodic discount adjustments, ensuring clean database lookups and standardized trial balances.

### 1.4 Rigid Fiscal Year Isolation (Fully Aligned)
Packs and accounting entries belong to exactly one fiscal year. Pack balances automatically reset to `0` at year-end; unused flight hours, winch launches, or tow-line allocations cannot be carried forward under any circumstances.

---

## Part 2: Technical Architecture & Core System Rules

To maintain absolute accounting integrity under French non-profit legislation (Law 1901), the engine adheres to these rigid rules:

```
                  +---------------------------------------+
                  | Validated Flight Imported from Planche |
                  +---------------------------------------+
                                      |
                                      v
                  +---------------------------------------+
                  |  Deterministic SHA-256 Billing Hash   |
                  |     (Locks Pricing Lines + Packs)     |
                  +---------------------------------------+
                                      |
                  +-------------------+-------------------+
                  |                                       |
                  v                                       v
    [ Gross Flight Billing ]                 [ Pack Consumption Engine ]
    - Journal: FL                            - Table: member_pack_consumptions
    - Status: Preview -> Draft -> Posted     - Logic: FIFO Allocation
    - Entry: 411 (Dr) / 706 (Cr)             - Validates asset scopes natively
                  |                                       |
                  +-------------------+-------------------+
                                      |
                                      v
                  +---------------------------------------+
                  |       Periodic REM Run Engine         |
                  |  Consolidates discounts into 1 Draft  |
                  |  Entry: 608 (Dr) / 411 (Cr) per pilot |
                  +---------------------------------------+
```

1. **Preview-First Execution:** Every flight billing operation begins as a side-effect-free data simulation. It reads the current pricing version and pack balance state without modifying the database.
2. **Deterministic Cryptographic Hash:** Every preview generates a `SHA-256` hash covering all resolved pricing lines and underlying discount consumption primary keys. If any background value (e.g., a changed machine rate or an unlinked pack) changes before the user commits, a **Hash Mismatch** error flags a warning.
3. **FIFO Pack Consumption Stack:** If a member owns multiple identical packs (e.g., two `PACK_25H_GLIDER` tokens), the system automatically depletes the oldest pack first based on its purchase timestamp.

---

## Part 3: Operational User Manual

### Chapter 1: The Daily Operations Flights Workspace
The **Daily Ops Flights Tab** serves as the cockpit for managing flight revenue generation and pack management. 

#### Step 1: Processing Imported Flights (Previews)
1. Navigate to **Daily Operations → Flights & Billing Cockpit**.
2. Unprocessed flights imported from Planche will display a status tag of `[Preview]`.
3. Review the **Gross Base Price** and the calculated **Estimated Discount**. 
4. Verify the **Billing Hash Indicator**. A **Green Icon** (`[Match Valid]`) indicates the background tables are perfectly synchronized.

#### Step 2: Committing Previews to Draft Status
1. Select one or multiple flight rows using the left-hand checkboxes.
2. Click **Generate Draft Bills (FL)** on the context action bar.
3. The system creates balanced double-entry accounting lines within the **`FL` Journal**. The flight status transitions to `[Draft]`.
4. *Note:* Draft entries are completely editable or reversible and do not impact the member's official ledger balance ledger.

#### Step 3: Formal Ledger Posting
1. Once a supervisor or chief pilot approves the draft batch, select the draft rows.
2. Click **Post Entries**. The entry state permanently locks to `[Posted]`. It is now immutable. To correct it later, you must run a full reversal workflow.

---

### Chapter 2: Pack Purchases & Retroactive Allocation

#### Section 2.1: Selling a Pack
1. Navigate to a member's profile or open the **Pack Catalog Management Tab**.
2. Select the desired asset pack (e.g., `PACK_25H_GLIDER`, `WINCH_PACK_10`).
3. Click **Issue Sale**. This instantly records a standard double-entry transaction:
   * **Debit:** `411xxx` (Member Account) — Gross Pack Cost
   * **Credit:** `706xxx` (Pack Sales Account assigned to the template)

#### Section 2.2: Executing a Retroactive Recalculation Run
If a pilot performs several flights, incurs high gross bills, and subsequently purchases an hourly pack to cover them:
1. Open the pilot's profile or select their rows inside the **Daily Ops Hub**.
2. Click **Force Retroactive Recalculation**.
3. The engine safely unwinds unposted or unadjusted flight balances back to the beginning of the current fiscal year.
4. It re-allocates units via FIFO, populates the `member_pack_consumptions` workspace, and updates the **Estimated Discount** column instantly.

---

### Chapter 3: Processing Periodic REM Adjustments
To credit the member's account for their pack savings without polluting daily flight records, administrators execute a **REM Adjustment Run** at scheduled intervals (weekly or monthly).

1. On the right side of the Daily Ops Hub, look at the **Discounts & Periodic REM Adjustments Panel**.
2. The grid displays a consolidated summary of all unposted discount values accumulated by each pilot during the current cycle.
3. Click **Preview REM Entry** to audit individual lines.
4. Click **Batch Process: Post All Accrued Discounts to REM Journal**.
5. The system automatically performs a single, optimized upsert operation per pilot, moving an accounting entry in status `Draft` into the official ledger:
   * **Debit:** `608xxx` (Pack Discount Expense Account)
   * **Credit:** `411xxx` (Member Account) — Total Discount Value Saved
6. The member's total outstanding balance decreases appropriately, completing the financial cycle.

---

## Part 4: Advanced UX/UI Expert Cockpit Blueprint

To satisfy technical criteria like "Preview-First tracking," "Deterministic Hash validation," and "Integrated Live Asset Balances," the following high-density split-pane workspace layout is specified.

### 4.1 Interface Layout Matrix
```
+------------------------------------------------------------------------------------------------------------------------+
|  DAILY OPERATIONS HUB  [ Fiscal Year: 2026 ]                                                [ VIEW_FINANCIALS ] [ Admin] |
+------------------------------------------------------------------------------------------------------------------------+
|  [TAB] Flights & Billing Cockpit    [TAB] Pack Catalog Management    [TAB] Machine Aggregation Dashboard              |
+------------------------------------------------------------------------------------------------------------------------+
|  FILTERS: [ Date Range: Current Week v ]  [ Member: All v ]  [ Status: Unbilled / Draft / Posted v ] [ Asset: All v ]  |
+------------------------------------------------------------------------------------------------------------------------+
|  OPERATIONAL FLIGHTS TRACKER                                                                                           |
|  [ ] FLIGHT ID | PILOT       | ASSET (REG)  | DURATION | BASE PRICE | EST. DISCOUNT | BILLING HASH (SHA-256) | STATUS    |
|  ---------------+-------------+--------------+----------+------------+---------------+------------------------+-----------|
|  [x] FL-2026-04 | D. Miller   | ASK-21 (F-C) | 01h 30m  | € 90.00    | - € 30.00     | 8f3b2a... [Match Valid] | [Preview] |
|  [x] FL-2026-05 | D. Miller   | Tow-Launch   | --       | € 35.00    | - €  0.00     | a1c9e4... [Match Valid] | [Preview] |
|  [ ] FL-2026-02 | S. Kowalski | Discus (F-G) | 02h 15m  | € 157.50   | - € 45.00     | 44b2d1... [Unposted]   | [Draft]   |
|  [ ] FL-2026-01 | A. Chen     | LS4 (F-P)    | 00h 45m  | € 45.00    | - € 15.00     | e9912a... [Committed]  | [Posted]  |
+------------------------------------------------------------------------------------------------------------------------+
|  SELECTED LINES ACTION BAR                                                                                             |
|  Selected: 2 Flights (D. Miller) | Total Gross: €125.00 | Est. Pack Release: 1.5 Hours Glider                          |
|  [ ACTION: Generate Draft Bills (FL) ]   [ ACTION: Force Retroactive Recalculation ]                                    |
+------------------------------------------------------------------------------------------------------------------------+
|                                                                                                                        |
|  SIDE PANEL: DISCOUNTS & PERIODIC REM ADJUSTMENTS (CURRENT PERIOD)                                                     |
|  +------------------------------------------------------------------------------------------------------------------+  |
|  | PILOT       | ACTIVE PACKS STATUS               | UNPOSTED DISCOUNT ACCRUED | ACTIONS                                |  |
|  | -------------+-----------------------------------+---------------------------+----------------------------------------|  |
|  | D. Miller   | - 25H Glider Pack (12.5h left)    | € 30.00                   | [ Preview REM Entry ]                  |  |
|  |             | - Winch Pack (3 launches left)    |                           |                                        |  |
|  | S. Kowalski | - 25H Glider Pack #2 (21.0h left) | € 45.00                   | [ Preview REM Entry ]                  |  |
|  +------------------------------------------------------------------------------------------------------------------+  |
|  | [ BATCH PROCESS: POST ALL ACCRUED DISCOUNTS TO REM JOURNAL ]                                                      |  |
|  +------------------------------------------------------------------------------------------------------------------+  |
+------------------------------------------------------------------------------------------------------------------------+
```

### 4.2 Critical UX/UI Micro-Interactions

1.  **Dynamic Status Badges:** * `[Preview]` displays in a soft neutral slate gray. It conveys that no rows have been appended to database journals yet.
    * `[Draft]` displays in amber. It implies the record is safely staged in the `FL` journal but awaits managerial authorization.
    * `[Posted]` displays in solid deep emerald green. It lets operators know at a glance that fields are permanently locked.
2.  **Interactive Hash Match Validator:** The `BILLING HASH` field features an interactive tooltip. If background pricing modifications happen after a preview has rendered, the indicator instantly flashes a high-contrast **Red `[Hash Mismatch]` state**, automatically disabling the "Generate Draft" action button until the desk agent clicks refresh.
3.  **Context-Aware Bulk Lower Action Shelf:** The bottom action bar slides up with a subtle animation only when one or more rows are active. It groups calculation aggregations in real time, preventing visual noise when managers are purely auditing static flight logs.
