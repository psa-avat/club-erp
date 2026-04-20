# Accounting Module Specification

## Purpose

This document defines the implementation specification for the Accounting module of the gliding club ERP.
It defines a double-entry ledger system tailored for a French "Association loi 1901" using the Plan Comptable Général (PCG) Association structure.
The target model must support normal ERP operations and later ingestion of historical accounting data without changing the meaning of imported records.
VAT is not actively calculated in the initial version, but the schema must preserve tax-bearing history when present.

## Design Decisions

1. **Double-Entry Ledger:** All financial movements must balance. For a given accounting entry, the sum of debits must exactly equal the sum of credits.
2. **French PCG (Associations):** The chart of accounts uses the French standard for associations.
3. **Fiscal Year First-Class:** Accounting data must explicitly identify the fiscal year. Fiscal year is not inferred only from `entry_date`.
4. **Partition-Ready Ledger:** Main transactional accounting tables are designed to support PostgreSQL partitioning by fiscal year.
5. **Member Sub-Ledger:** Member receivables use a collective class `411` control account combined with member identity dimensions (`member_uuid` and `member_account_id_snapshot`).
6. **Generalized Analytical Accounting:** Expenses and revenues can be tagged with an `analytical_asset_uuid` to track the profitability and costs of specific club assets (e.g., gliders, tow planes, winches, buildings).
7. **Draft-First Immutability:** Entries can remain in a `Draft` state for extended periods to allow treasurer review and adjustment. Once `Posted`, accounting data becomes immutable. Corrections must be represented by reversal or correction entries, not in-place edits. Historical imported data also becomes immutable on arrival.
8. **Decimals:** All financial amounts are stored as `NUMERIC(10,4)` in PostgreSQL to handle exact fractional amounts natively, matching frontend `decimal.js` usage.

## Domain Model

### 1. Fiscal Year
Represents the accounting year used for posting, locking, carry-forward, and partitioning.
- Has a stable identifier and year label.
- Defines `start_date` and `end_date`.
- Tracks operational state: open, closed, or reopened.
- Controls whether new entries may be posted into the year.
- Is explicitly stored on accounting entries.

### 2. Account (Chart of Accounts)
Represents a PCG accounting code.
- Uses a hierarchical code structure (e.g., `4`, `41`, `411`).
- Contains the account type (Asset, Liability, Equity, Expense, Revenue).
- Defines whether the account is posting-allowed or only a grouping account.
- Defines whether the account is reconcilable (e.g., members, suppliers, banks).
- Preserves archived accounts for historical visibility even if they can no longer be selected for new postings.
- May optionally point to a replacement account for operational guidance.

### 3. Journal
Categorises entries based on their nature. Typical journals:
- `VT` (Ventes / Sales): Flight billing, club memberships.
- `HA` (Achats / Purchases): Supplier invoices.
- `BQ` (Banque / Bank): Bank movements.
- `CS` (Caisse / Cash): Cash register.
- `AN` (À Nouveaux / Opening): Opening balances and carry-forward entries.
- `OD` (Opérations Diverses / Misc): Year-end operations, payroll adjustments, manual corrections.

### 4. Accounting Entry (Transaction Header)
Represents an atomic financial transaction.
- Tied to a Journal.
- Belongs to exactly one Fiscal Year.
- Has an `entry_date` that must fall within the fiscal year boundaries.
- Contains a human description plus traceable business references.
- Status: `Draft`, `Posted`, `Cancelled`.
- Once `Posted`, becomes immutable.
- May be linked to a reversal or correction chain.

### 5. Accounting Line
The core double-entry line item.
- Belongs to an Entry and is tagged with an Account.
- Stores `debit` and `credit` columns for clarity.
- **Member Dimension:** Tracks `member_uuid` and `member_account_id_snapshot` for individual member balances and historical stability.
- **Asset Dimension:** Tracks `analytical_asset_uuid` for assigning costs/revenues to specific club equipment (gliders, tow planes, winches, buildings).
- May store tax snapshot information even if no active VAT engine is used.
- Must remain historically stable even if the related member or account master changes later.

### 6. Opening Balance Entry
Represents the start-of-year carry-forward or imported opening position of one fiscal year.
- Uses journal `AN`.
- Belongs to exactly one Fiscal Year.
- Is posted directly or generated from the prior fiscal year close, depending on operational workflow.
- Preserves imported opening positions when history is loaded from a legacy system.

## Fiscal Year Rules

- A fiscal year must be explicitly created before entries can be posted into it.
- `entry_date` must be between the fiscal year's `start_date` and `end_date`.
- `Posted` entries may only be created in an open or reopened fiscal year.
- Closing a fiscal year prevents new postings and modifications of draft entries in that year.
- Reopening a fiscal year is an explicit privileged action and must be auditable.
- Opening balances for fiscal year `N` originate from the closing state of fiscal year `N-1` or from a controlled import.

## Accounting Rules

- **Balance Constraint:** For each entry, `SUM(debit) = SUM(credit)`.
- **Positive Amounts:** `debit >= 0` and `credit >= 0`.
- **Non-Empty Lines:** Each line must carry a non-zero accounting amount.
- **Immutability:** Once an Entry is `Posted`, neither the header nor its lines may be modified or deleted.
- **Correction by Reversal:** Any correction of a posted entry requires a reversal or correction entry linked to the original entry.
- **Draft Flexibility:** While an Entry is in `Draft` state, its header and lines may be edited, added to, or removed to facilitate treasurer review.
- **Historical Fidelity:** Imported historical entries retain their original posting dates, references, and provenance, then become immutable in the ERP.
- **Analytical Recommendation:** All lines using Class 6 (Expenses) or Class 7 (Revenue) accounts should carry an `analytical_asset_uuid` when the transaction relates to club equipment.

- **Integrity & Hashing Workflow :** Transition to Posted: When calling PATCH /post, the system verifies the balance.
Sealing: The backend concatenates the entry details and line amounts into a canonical string and generates a SHA-256 hash.
Locking: The entry_hash and sequence_number are saved, and the state is set to Posted. The database triggers then prevent any further changes.

## Partitioning Strategy

`accounting_entries` and `accounting_lines` are implemented as PostgreSQL `PARTITION BY LIST (fiscal_year_uuid)` tables. A new partition is created for each fiscal year when it is opened.

**Implications for schema design:**

- PostgreSQL requires the partition key to be part of every `PRIMARY KEY` and `UNIQUE` constraint on a partitioned table. Therefore both tables use **composite primary keys**: `(uuid, fiscal_year_uuid)`.
- The foreign key from `accounting_lines` to `accounting_entries` becomes composite: `(entry_uuid, fiscal_year_uuid)` → `(uuid, fiscal_year_uuid)`. This also enforces fiscal-year consistency between lines and their parent entry at the database level, removing the need for a separate trigger.
- The self-referential `reversal_of_entry_uuid` column on `accounting_entries` **cannot** carry a database-level FK constraint on a partitioned table (cross-partition self-references are not supported by PostgreSQL). Referential integrity for reversal chains is enforced at the application layer.
- A `DEFAULT` partition exists on both tables to receive rows before a year-specific partition is created. Rows must be migrated to the correct partition once the year partition is created.
- Indexes defined on the parent table automatically propagate to all child partitions.
- `accounting_fiscal_years`, `accounting_accounts`, and `accounting_journals` are **not** partitioned; they are master tables referenced normally by FK from the partitioned tables.

**Partition lifecycle:**
1. When a fiscal year is opened, the application creates `accounting_entries_<code>` and `accounting_lines_<code>` partitions `FOR VALUES IN ('<fiscal_year_uuid>')` before any entries are posted.
2. Rows that landed in the `DEFAULT` partition (e.g. from seeding) must be migrated to the correct year partition.
3. When a fiscal year is closed, its partition may be moved to a read-only tablespace for archival.
4. Historical years can be detached and archived without schema migration.

## VAT Readiness

Although VAT is not operationally calculated in the initial version, readiness is achieved by:
- Including standard PCG VAT accounts in the seed data, notably class `4456` and `4457` accounts as needed.
- Preserving optional tax snapshot fields on accounting lines.
- Allowing imported history to keep tax code, tax rate, tax base, and tax amount when present.

## Provenance and Traceability

Imported or generated accounting data must remain traceable.

- Entries may carry a `source_system` value identifying their origin.
- Entries may carry an `external_id` or `original_id` used by the source system.
- Entries may carry an `import_batch_id` for idempotent controlled imports.
- Entries may store original business timestamps separately from ERP creation timestamps.
- Posted numbering and business references must remain immutable.
- Reversal relationships must remain queryable.

## Database Specification

The database design handles the requirements defined above.

### Table: `accounting_fiscal_years`
- `uuid UUID PRIMARY KEY`
- `code VARCHAR(16) NOT NULL UNIQUE` (e.g. `FY2026`)
- `label VARCHAR(64) NOT NULL` (e.g. `Exercice 2026`)
- `year SMALLINT NOT NULL UNIQUE`
- `start_date DATE NOT NULL`
- `end_date DATE NOT NULL`
- `state SMALLINT NOT NULL DEFAULT 1` (1=Open, 2=Closed, 3=Reopened)
- `closed_at TIMESTAMPTZ NULL`
- `closed_by INTEGER NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

### Table: `accounting_journals`
- `uuid UUID PRIMARY KEY`
- `code VARCHAR(10) NOT NULL UNIQUE` (e.g. `VT`, `BQ`, `AN`)
- `name VARCHAR(100) NOT NULL`
- `type SMALLINT NOT NULL` (1=Sale, 2=Purchase, 3=Bank, 4=Cash, 5=General, 6=Opening)
- `default_account_uuid UUID NULL` (e.g. link to `512xxx` for a bank journal)
- `is_active BOOLEAN NOT NULL DEFAULT TRUE`

### Table: `accounting_accounts`
- `uuid UUID PRIMARY KEY`
- `code VARCHAR(32) NOT NULL UNIQUE` (PCG code)
- `name VARCHAR(255) NOT NULL`
- `type SMALLINT NOT NULL` (1=Asset, 2=Liability, 3=Equity, 4=Expense, 5=Revenue)
- `parent_account_uuid UUID NULL`
- `is_posting_allowed BOOLEAN NOT NULL DEFAULT TRUE`
- `normal_balance SMALLINT NOT NULL` (1=Debit, 2=Credit)
- `is_reconcilable BOOLEAN NOT NULL DEFAULT FALSE`
- `is_active BOOLEAN NOT NULL DEFAULT TRUE`
- `archived_at TIMESTAMPTZ NULL`
- `replacement_account_uuid UUID NULL`

### Table: `accounting_entries`
- `uuid UUID PRIMARY KEY`
- `fiscal_year_uuid UUID NOT NULL` References `accounting_fiscal_years`
- `journal_uuid UUID NOT NULL` References `accounting_journals`
- `entry_date DATE NOT NULL`
- `sequence_number VARCHAR(64) NULL` (immutable once posted)
- `reference VARCHAR(255) NULL` (business reference shown to users)
- `source_document_ref VARCHAR(255) NULL`
- `source_document_date DATE NULL`
- `description VARCHAR(255) NOT NULL`
- `state SMALLINT NOT NULL DEFAULT 1` (1=Draft, 2=Posted, 3=Cancelled)
- `source_system VARCHAR(64) NULL`
- `external_id VARCHAR(255) NULL`
- `import_batch_id VARCHAR(64) NULL`
- `original_created_at TIMESTAMPTZ NULL`
- `original_posted_at TIMESTAMPTZ NULL`
- `reversal_of_entry_uuid UUID NULL` References `accounting_entries`
- `reversal_reason VARCHAR(255) NULL`
- `posted_at TIMESTAMPTZ NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `created_by INTEGER NOT NULL`

### Table: `accounting_lines`
- `uuid UUID PRIMARY KEY`
- `fiscal_year_uuid UUID NOT NULL` References `accounting_fiscal_years`
- `entry_uuid UUID NOT NULL` References `accounting_entries`
- `account_uuid UUID NOT NULL` References `accounting_accounts`
- `member_uuid UUID NULL` References `members.uuid`
- `member_account_id_snapshot VARCHAR(32) NULL`
- `analytical_asset_uuid UUID NULL` References `club_assets.uuid` (future; used to track costs/revenues by asset)
- `debit NUMERIC(10,4) NOT NULL DEFAULT 0.0000`
- `credit NUMERIC(10,4) NOT NULL DEFAULT 0.0000`
- `description VARCHAR(255) NULL`
- `tax_id UUID NULL` (future tax catalog integration)
- `tax_code VARCHAR(64) NULL`
- `tax_rate NUMERIC(10,4) NULL`
- `tax_base NUMERIC(10,4) NULL`
- `tax_amount NUMERIC(10,4) NULL`

**Integrity Constraints:**
- `debit >= 0` and `credit >= 0`
- `debit > 0 OR credit > 0`
- `fiscal_year_uuid` on a line must match the fiscal year of its parent entry
- `entry_date` must fall inside the referenced fiscal year boundaries
- `SUM(debit) = SUM(credit)` for a given `entry_uuid` when state transitions to `Posted`
- once `state = Posted`, the entry header and all related lines become immutable

## Opening Balance and Carry-Forward Rules

- Each fiscal year may contain one or more opening balance entries in journal `AN`.
- Opening balances may be generated from the previous fiscal year close or loaded from controlled import data.
- Opening balances are ledger entries, not attributes of account masters.
- Carry-forward behavior depends on account family and club accounting rules.
- Member receivable balances may be carried forward while preserving member identity snapshots.

## Member Sub-ledger Integration

Member financial balances are calculated dynamically by aggregating `debit - credit` on `accounting_lines` for the member dimension.

Canonical model:
- the general ledger uses a collective `411` control account for member receivables
- each member-linked line stores `member_uuid`
- each member-linked line also stores `member_account_id_snapshot` so imported and historical entries remain stable even if the member record later changes

For member registrations, the system auto-generates `accounting_entries` linked to the Sales (`VT`) journal and credits the appropriate `7*` class account depending on the price mapping, whilst debiting the `411` member receivable control account with the member dimensions filled.

This model must remain aligned with the members specification, where `account_id` is the stable business key used by the member domain.

## Reversal and Correction Rules

- A posted entry is never edited in place.
- A reversal entry references the original entry through `reversal_of_entry_uuid`.
- Reversal entries preserve auditability and may be generated by users or controlled import.
- A cancelled business event is represented by accounting reversal, not physical deletion of ledger data.
- Imported historical correction chains must be preserved using the same linkage model where possible.

## Endpoints Scope

V1 backend should support:
- `POST /api/v1/accounting/fiscal-years` (creates a new fiscal year, ready for posting)
- `GET /api/v1/accounting/fiscal-years` (lists all fiscal years)
- `GET /api/v1/accounting/accounts` (lists chart of accounts)
- `GET /api/v1/accounting/journals` (lists journals)
- `POST /api/v1/accounting/entries` (creates entry and lines atomically in Draft state)
- `GET /api/v1/accounting/entries/{uuid}` (retrieves entry with lines)
- `PUT /api/v1/accounting/entries/{uuid}` (updates header and lines while entry is in Draft)
- `PATCH /api/v1/accounting/entries/{uuid}/post` (validates balance and fiscal year rules, then locks the entry)
