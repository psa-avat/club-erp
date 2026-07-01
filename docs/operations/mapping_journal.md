# Journal to Account Mapping (French PCG Rules)

This document maps the journals defined in `SPEC_ACCOUNTING.md` to the accounts provided in the `pcg_seed.json` for the Gliding Club ERP.

## 1. VT - Sales (Ventes)
Used for membership subscriptions and miscellaneous sales (Boutique, Bar, Refacturation).
*   **Debit side:** `411` (Membres - Créances).
*   **Credit side (Revenue):** `7061` (Cotisations et adhésions), `7071` (Ventes boutique), `7072` (Ventes bar et repas), `708` (Produits activités annexes), `7561` (Cotisations et adhésions membres), `740` (Subventions d'exploitation), `771` (Dons).
*   **Credit side (Tax):** `44571` (TVA collectée).

## 2. HA - Purchases (Achats)
Used for all external supplier invoices for goods and services.
*   **Debit side (Expenses):** `602` (Mat. premières), `605` (Matériel/travaux), `606` (Energie/petit matériel), `6063` (Carburants), `615` (Entretien), `616` (Assurances), `618` (Documentation), `622` (Honoraires), `623` (Publicité), `625` (Déplacements), `626` (Poste/Telecom), `627` (Services bancaires), `628` (Cotisations techniques), `635` (Taxes/Redevances).
*   **Debit side (Tax):** `44566` (TVA sur autres biens et services).
*   **Credit side:** `401` (Fournisseurs), `402` (Fournisseurs d'immobilisations).

## 3. BQ - Bank (Banque)
Used for all transactions appearing on the bank statements.
*   **Counterparty:** `512` (Banque), `521` (Placements de trésorerie).
*   **Matching Accounts:** `411` (Membres), `401/402` (Fournisseurs), `580` (Virements internes), `164` (Emprunts), `661` (Intérêts), `275` (Dépôts et cautionnements).

## 4. CS - Cash (Caisse)
Used for small local expenses or cash payments from members.
*   **Counterparty:** `530` (Caisse), `531` (Caisse espèces), `540` (Régies d'avances).
*   **Matching Accounts:** `411` (Ventes membres), `7072` (Ventes bar et repas), `625` (Déplacements, missions et réceptions).

## 5. OD - Miscellaneous Operations (Opérations Diverses)
Used for non-cash adjustments, payroll, and project-specific fund movements.
*   **Payroll:** `641` (Rémunérations), `645` (Social) matched against `428` (Personnel - Charges à payer), `431/432/437` (Social), `425` (Personnel - Avances).
*   **Provisions/Funds:** `151` (Provisions pour risques), `194` (Fonds dédiés sur projets), `689/789` (Engagements/Reports fonds dédiés).
*   **Adjustments:** `487` (Produits constatés d'avance), `468` (Charges à payer divers), `471` (Comptes d'attente).

## 6. AN - Opening Balance (A-nouveaux)
Used for the initial balance of the fiscal year.
*   **Assets (Dr):** `212` (Agencements), `215` (Installations), `2185` (Aéronefs), `272` (Titres), `322` (Stocks), `512` (Banque), `530` (Caisse).
*   **Liabilities/Equity (Cr):** `102` (Fonds associatif), `110` (Report à nouveau), `120` (Résultat), `131` (Subventions équipement), `151` (Provisions), `164` (Emprunts), `401` (Fournisseurs).

## 7. FL - Flights (Vols)
Specialized sales journal dedicated to automated flight billing.
*   **Debit side:** `411` (Membres - Créances).
*   **Credit side (Revenue):** `7062` (Activité vol - Heures cellule), `7063` (Produit des lancements).

## 8. REM - Pack Discount Adjustments (Remises)
Dedicated adjustment journal that settles member pack/discount consumption. Flights are always billed at gross price in the FL journal; REM entries are aggregated per pilot per period (one Draft entry, upserted as discounts accumulate) to apply the discount without polluting the gross flight revenue stream.
*   **Debit side (Expense):** `6xx` (Rabais et remises accordés — configurable class 6 pack discount expense account, `default_pack_discount_expense_account_uuid`).
*   **Credit side:** `411` (Membres - Créances).

---

### Summary Table

| Code | Name | Type | Primary Debit | Primary Credit |
| :--- | :--- | :--- | :--- | :--- |
| **VT** | Sales | Sale | 411 | 7xx / 44571 |
| **HA** | Purchases | Purchase | 6xx / 44566 | 401 / 402 |
| **BQ** | Bank | Bank | 512 / 521 | 4xx / 5xx |
| **CS** | Cash | Cash | 530 / 531 | 4xx / 7xx |
| **OD** | Misc Ops | General | 64x / 1xx / 4xx | 4xx / 1xx |
| **AN** | Opening | Opening | 2xx / 3xx / 5xx | 1xx / 4xx |
| **FL** | Flights | Flight | 411 | 7062 / 7063 |
| **REM** | Discount Adjustments | Adjustment | 6xx | 411 |