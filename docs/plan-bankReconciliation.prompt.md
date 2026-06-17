# Plan 046 — Rapprochements Bancaires (v4)

## TL;DR

Importation de relevés bancaires (OFX prioritaire, CSV, QIF, MT940), matching automatique par score contre les écritures des journaux **Banque (type=3) et Caisse (type=4) uniquement**, validation manuelle en workspace split-panel, génération d'écritures correctives en Draft, clôture et exportation du rapport (JSON/PDF en téléchargement direct). L'état du rapprochement est entièrement porté par `bank_statement_lines` — `accounting_lines` n'est pas modifiée.

**Règles métier spécifiques au club :**

- **Versements pilotes directs** : les pilotes versent directement sur leur compte de tiers (411) sans facture émise au runtime. Le matching 1-à-1 est suffisant — la ligne de relevé va chercher l'écriture correspondante déjà saisie au journal de banque.
- **Paiements CE éclatés** : les versements globaux des Comités d'Entreprise sont saisis en une unique écriture multi-lignes (débit 512 global / crédits 411 individuels). Le rapprochement s'effectue 1-à-1 sur l'UUID de l'écriture globale.

---

## Périmètre des écritures rapprochables

Seules les écritures des journaux de **type Banque (3) ou Caisse (4)** sont candidates au matching.

- Le compte sélectionné à l'import doit appartenir à un journal de type 3 ou 4 → **validé à l'import**.
- Le moteur de matching filtre exclusivement sur `accounting_journals.type IN (3, 4)`.
- Journaux vente (1), achat (2), général (5), ouverture (6), vols (7) → **hors scope**.

```sql
-- Filtre appliqué dans run_auto_match()
JOIN accounting_journals j ON ae.journal_uuid = j.uuid
WHERE j.type IN (3, 4)   -- Banque + Caisse uniquement
```

---

## Workflow

```
IMPORT (compte Banque/Caisse) → PARSING → MATCHING AUTO → VALIDATION → CLÔTURE → EXPORT
                                                               ↓
                                                 Écriture corrective Draft
```

| Phase | Action | Composant |
|---|---|---|
| 1 | Upload + sélection compte Banque/Caisse | Drag & drop avec filtrage compte |
| 2 | Parser → lignes normalisées | Parsers par format |
| 3 | Scoring contre écritures journaux type 3/4 | Moteur de matching |
| 4 | Valider / associer manuellement | Workspace split-panel |
| 5 | Clôturer | Verrouillage période |
| 6 | Exporter rapport PDF ou JSON | Téléchargement direct |

---

## Formats supportés

| Format | Extension | Parser |
|---|---|---|
| **OFX/QFX** (prioritaire) | `.ofx`, `.qfx` | `ofxparse` |
| CSV | `.csv` | Interne + mapping wizard |
| QIF | `.qif` | Interne |
| MT940 | `.940`, `.sta` | Interne (champs :61/:86) |

---

## Phase A — Migration SQL

**Fichier** : `docs/migrations/046_bank_reconciliation.sql`

```sql
-- ============================================================
-- 1. Relevés bancaires
-- ============================================================
CREATE TABLE bank_statements (
    uuid                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fiscal_year_uuid       UUID NOT NULL REFERENCES accounting_fiscal_years(uuid) ON DELETE CASCADE,
    -- account_uuid doit appartenir à un journal de type 3 (Banque) ou 4 (Caisse)
    -- validé au niveau applicatif lors de l'import
    account_uuid           UUID NOT NULL REFERENCES accounting_accounts(uuid),
    import_date            TIMESTAMPTZ NOT NULL DEFAULT now(),
    statement_date         DATE NOT NULL,
    statement_period_start DATE,
    statement_period_end   DATE,
    source_format          VARCHAR(8) NOT NULL,  -- 'ofx' | 'csv' | 'qif' | 'mt940'
    raw_filename           VARCHAR(255),
    raw_content_hash       VARCHAR(64),          -- SHA-256, déduplication
    opening_balance        NUMERIC(10,4) DEFAULT 0,
    closing_balance        NUMERIC(10,4) DEFAULT 0,
    total_debits           NUMERIC(10,4) DEFAULT 0,
    total_credits          NUMERIC(10,4) DEFAULT 0,
    line_count             INTEGER DEFAULT 0,
    -- Statuts : imported | matching | reconciled | flagged
    -- 'flagged' positionné automatiquement par detect_discrepancies()
    status                 VARCHAR(16) NOT NULL DEFAULT 'imported',
    reconciled_balance     NUMERIC(10,4),
    balance_difference     NUMERIC(10,4),
    reconciled_at          TIMESTAMPTZ,
    reconciled_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by             INTEGER NOT NULL REFERENCES users(id),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bank_statements_fy      ON bank_statements(fiscal_year_uuid);
CREATE INDEX idx_bank_statements_account ON bank_statements(account_uuid);
CREATE INDEX idx_bank_statements_status  ON bank_statements(status);
CREATE INDEX idx_bank_statements_hash    ON bank_statements(raw_content_hash)
    WHERE raw_content_hash IS NOT NULL;

-- ============================================================
-- 2. Lignes de relevé bancaire
-- ============================================================
-- L'état du rapprochement est intégralement ici.
-- accounting_lines n'est PAS modifiée :
--   • immutabilité des écritures postées préservée
--   • pas de duplication d'état
--   • pas de FK composite à gérer (accounting_entries a une PK composite)
-- Cardinalité : 1-à-1 par défaut (suffisant pour les flux du club)
-- ============================================================
CREATE TABLE bank_statement_lines (
    uuid                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    statement_uuid           UUID NOT NULL REFERENCES bank_statements(uuid) ON DELETE CASCADE,
    line_index               INTEGER NOT NULL DEFAULT 0,
    line_date                DATE NOT NULL,
    description              TEXT,
    amount                   NUMERIC(10,4) NOT NULL,  -- positif = crédit, négatif = débit
    reference                VARCHAR(255),
    counterparty             VARCHAR(255),
    bank_raw_data            JSONB,                    -- données brutes OFX (FITID, etc.)
    -- Statuts : unmatched | auto_matched | manually_matched | excluded | discrepancy
    match_status             VARCHAR(20) NOT NULL DEFAULT 'unmatched',
    -- Références vers l'écriture GL — pas de FK DB (PK composite sur accounting_entries)
    -- Pattern identique à reversal_of_entry_uuid dans le projet
    matched_entry_uuid       UUID,
    matched_fiscal_year_uuid UUID,
    match_confidence         NUMERIC(4,3),
    discrepancy_type         VARCHAR(32),
    discrepancy_notes        TEXT,
    resolved_at              TIMESTAMPTZ,
    resolved_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bank_lines_statement     ON bank_statement_lines(statement_uuid);
CREATE INDEX idx_bank_lines_status        ON bank_statement_lines(match_status);
CREATE INDEX idx_bank_lines_matched_entry ON bank_statement_lines(matched_entry_uuid)
    WHERE matched_entry_uuid IS NOT NULL;
CREATE INDEX idx_bank_lines_date_amount   ON bank_statement_lines(line_date, amount);

-- ============================================================
-- 3. Mappings CSV sauvegardés par utilisateur
-- date_format explicite : sécurité anti-inversion jour/mois (bug historique)
-- ============================================================
CREATE TABLE bank_csv_mappings (
    uuid           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name           VARCHAR(100) NOT NULL,
    created_by     INTEGER NOT NULL REFERENCES users(id),
    column_mapping JSONB NOT NULL,
    separator      VARCHAR(4),
    encoding       VARCHAR(16),
    date_format    VARCHAR(16) NOT NULL DEFAULT 'DD/MM/YYYY',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

> **Vérifier si une écriture est rapprochée** (sans toucher `accounting_lines`) :
> ```sql
> SELECT EXISTS (
>   SELECT 1 FROM bank_statement_lines
>   WHERE matched_entry_uuid = $entry_uuid
>     AND match_status IN ('auto_matched', 'manually_matched')
> );
> ```

---

## Phase B — Modèle Python

**Fichier** : `backend/models.py`

```python
class BankStatement(Base):
    __tablename__ = "bank_statements"

    uuid                   = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    fiscal_year_uuid       = Column(UUID(as_uuid=True), ForeignKey("accounting_fiscal_years.uuid", ondelete="CASCADE"), nullable=False, index=True)
    account_uuid           = Column(UUID(as_uuid=True), ForeignKey("accounting_accounts.uuid"), nullable=False, index=True)
    import_date            = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    statement_date         = Column(Date, nullable=False)
    statement_period_start = Column(Date, nullable=True)
    statement_period_end   = Column(Date, nullable=True)
    source_format          = Column(String(8), nullable=False)
    raw_filename           = Column(String(255), nullable=True)
    raw_content_hash       = Column(String(64), nullable=True)
    opening_balance        = Column(Numeric(10, 4), default=0)
    closing_balance        = Column(Numeric(10, 4), default=0)
    total_debits           = Column(Numeric(10, 4), default=0)
    total_credits          = Column(Numeric(10, 4), default=0)
    line_count             = Column(Integer, default=0)
    status                 = Column(String(16), nullable=False, default='imported')
    reconciled_balance     = Column(Numeric(10, 4), nullable=True)
    balance_difference     = Column(Numeric(10, 4), nullable=True)
    reconciled_at          = Column(DateTime(timezone=True), nullable=True)
    reconciled_by          = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_by             = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at             = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at             = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    fiscal_year = relationship("AccountingFiscalYear")
    account     = relationship("AccountingAccount")
    lines       = relationship("BankStatementLine", back_populates="statement", cascade="all, delete-orphan")


class BankStatementLine(Base):
    __tablename__ = "bank_statement_lines"

    uuid                     = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    statement_uuid           = Column(UUID(as_uuid=True), ForeignKey("bank_statements.uuid", ondelete="CASCADE"), nullable=False, index=True)
    line_index               = Column(Integer, nullable=False, default=0)
    line_date                = Column(Date, nullable=False)
    description              = Column(Text, nullable=True)
    amount                   = Column(Numeric(10, 4), nullable=False)
    reference                = Column(String(255), nullable=True)
    counterparty             = Column(String(255), nullable=True)
    bank_raw_data            = Column(JSON, nullable=True)
    match_status             = Column(String(20), nullable=False, default='unmatched')
    matched_entry_uuid       = Column(UUID(as_uuid=True), nullable=True, index=True)   # no DB FK
    matched_fiscal_year_uuid = Column(UUID(as_uuid=True), nullable=True)
    match_confidence         = Column(Numeric(4, 3), nullable=True)
    discrepancy_type         = Column(String(32), nullable=True)
    discrepancy_notes        = Column(Text, nullable=True)
    resolved_at              = Column(DateTime(timezone=True), nullable=True)
    resolved_by              = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at               = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    statement = relationship("BankStatement", back_populates="lines")


class BankCsvMapping(Base):
    __tablename__ = "bank_csv_mappings"

    uuid           = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    name           = Column(String(100), nullable=False)
    created_by     = Column(Integer, ForeignKey("users.id"), nullable=False)
    column_mapping = Column(JSON, nullable=False)
    separator      = Column(String(4), nullable=True)
    encoding       = Column(String(16), nullable=True)
    date_format    = Column(String(16), nullable=False, default='DD/MM/YYYY')
    created_at     = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
```

---

## Phase C — Parsers

**Fichier** : `backend/services/bank_parsers.py`

### Format normalisé

```python
@dataclass
class ParsedLine:
    line_date    : date
    description  : str
    amount       : Decimal   # positif = crédit, négatif = débit
    reference    : str = ''
    counterparty : str = ''
    fit_id       : str | None = None
    raw_data     : dict | None = None

@dataclass
class ParsedStatement:
    account_id      : str | None
    period_start    : date | None
    period_end      : date | None
    opening_balance : Decimal | None
    closing_balance : Decimal | None
    raw_format      : str
    lines           : list[ParsedLine] = field(default_factory=list)
    warnings        : list[str] = field(default_factory=list)
```

### Parsers

```python
def detect_format(filename: str, content: bytes) -> str:
    """Extension d'abord (.ofx/.qfx → 'ofx', .qif → 'qif', .940/.sta → 'mt940', .csv → 'csv'),
    puis analyse contenu si ambiguë (OFXHEADER, !Type:Bank)."""

class OfxParser:
    """ofxparse — OFX 1.x (SGML : SG/CA/BNP/Crédit Mutuel) et 2.x (XML).
    FITID dédupliqué. Erreurs par transaction skippées avec warning."""

class CsvParser:
    """Séparateur auto-détecté (virgule/point-virgule/tab).
    Encodage auto (chardet). Format de date lu depuis BankCsvMapping.date_format
    — élimine le risque d'inversion jour/mois (bug historique DD/MM vs MM/DD).
    Nombres français (1.234,56) et anglais."""

class QifParser:
    """!Type:Bank + champs D/T/M/P → ParsedLine."""

class Mt940Parser:
    """Champs SWIFT :61: (montant/date) et :86: (description) → ParsedLine."""

async def import_statement(
    db, fiscal_year_uuid, account_uuid, file_content, filename, user_id,
    csv_mapping_uuid=None,  # obligatoire pour les fichiers CSV
) -> BankStatement:
    """
    1. Vérifier que le compte appartient à un journal type IN (3, 4)
       → sinon lever InvalidAccountError
    2. detect_format()
    3. Parser correspondant → ParsedStatement
       (CsvParser charge BankCsvMapping.date_format si csv_mapping_uuid fourni)
    4. Vérifier SHA-256 : doublon → DuplicateStatementError
    5. Créer BankStatement + BankStatementLines
    6. Vérifier équilibre : opening + crédits - débits ≈ closing (warning si écart)
    """
```

---

## Phase D — Moteur de Matching

**Fichier** : `backend/services/bank_reconciliation.py`

### Périmètre des écritures candidates

```python
ELIGIBLE_ENTRIES_QUERY = """
    SELECT ae.uuid, ae.fiscal_year_uuid, ae.entry_date, ae.reference,
           al.debit, al.credit
    FROM accounting_entries ae
    JOIN accounting_lines al ON al.entry_uuid = ae.uuid
                             AND al.fiscal_year_uuid = ae.fiscal_year_uuid
    JOIN accounting_journals aj ON aj.uuid = ae.journal_uuid
    WHERE aj.type IN (3, 4)          -- Banque + Caisse uniquement
      AND ae.fiscal_year_uuid = :fy_uuid
      AND ae.state = 2               -- Postées uniquement
      AND ae.reversal_of_entry_uuid IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM bank_statement_lines bsl
          WHERE bsl.matched_entry_uuid = ae.uuid
            AND bsl.match_status IN ('auto_matched', 'manually_matched')
      )
"""
```

### Scoring

| Stratégie | Score | Comportement |
|---|---|---|
| Montant + référence + date ±1j | 1.0 | Auto-accept |
| Montant + date exacte | 0.95 | Auto-accept |
| Montant + date ±3j | 0.85 | Auto-accept |
| Montant seul | 0.40–0.60 | Revue manuelle |
| Aucune correspondance | 0.0 | `unmatched` |

**Seuil** : ≥ 0.90 → `auto_matched` ; 0.40–0.89 → `discrepancy` ; < 0.40 → `unmatched`

**Cardinalité** : relation 1-à-1 stricte — adaptée aux flux pilotes (411 directs) et CE (écriture multi-lignes déjà ventilée au journal de banque).

**Virement interne** : même montant ±0 jour sur le même compte → score plafonné à 0.60.

```python
async def run_auto_match(db, statement_uuid) -> dict:
    """{ auto_matched: int, flagged_review: int, unmatched: int }"""

async def manual_match(db, line_uuid, entry_uuid, fiscal_year_uuid, user_id) -> BankStatementLine:
    """Vérifier journal type IN (3, 4) avant association. Lever InvalidEntryError sinon."""

async def unmatch(db, line_uuid, reason: str) -> BankStatementLine:
    """status = 'unmatched', effacer matched_entry_uuid / matched_fiscal_year_uuid."""
```

---

## Phase E — Écarts et Clôture

```python
async def detect_discrepancies(db, statement_uuid) -> list[dict]:
    """
    4 types :
    - missing_entry   : ligne sans match → suggérer création écriture
    - amount_variance : matché mais montant diffère → proposer correction
    - timing          : date banque - date écriture > 7j → flag
    - duplicate       : 2 lignes matchées sur 1 écriture → flag
    Si des écarts → statement.status = 'flagged'
    """

async def create_correcting_entry(db, line_uuid, account_uuid, fiscal_year_uuid, user_id) -> AccountingEntry:
    """
    Écriture Draft (state=1) dans un journal type 3 ou 4.
    Description : 'Correction rapprochement - {description}'
    Référence   : 'RAPPRO-{statement_date}-{line_index}'
    """

async def close_reconciliation(db, statement_uuid, user_id) -> BankStatement:
    """
    1. Vérifier : aucune ligne 'unmatched' ou 'discrepancy' non résolue
    2. Vérifier équilibre closing ≈ sum(matched amounts)
    3. statement.status = 'reconciled', reconciled_at, reconciled_by
    """

async def get_reconciliation_report(db, statement_uuid) -> dict:
    """Période, soldes, stats matching, écritures correctives, lignes non résolues."""
```

---

## Phase F — Endpoints API & Téléchargement

**Fichier** : `backend/api/routes/reconciliation.py` (nouveau)

```
POST   /api/v1/reconciliation/import                           → 201
GET    /api/v1/reconciliation/statements                       → list
GET    /api/v1/reconciliation/statements/{uuid}                → détail + lignes
DELETE /api/v1/reconciliation/statements/{uuid}                → 204

POST   /api/v1/reconciliation/statements/{uuid}/match          → MatchResult
POST   /api/v1/reconciliation/manual-match                     → BankStatementLine
POST   /api/v1/reconciliation/unmatch                          → BankStatementLine

GET    /api/v1/reconciliation/statements/{uuid}/discrepancies  → list
POST   /api/v1/reconciliation/resolve-discrepancy              → resolution
POST   /api/v1/reconciliation/statements/{uuid}/close          → BankStatement
GET    /api/v1/reconciliation/statements/{uuid}/report         → données rapport (JSON, pour affichage UI)
GET    /api/v1/reconciliation/statements/{uuid}/report/download?format=pdf|json → téléchargement

GET    /api/v1/reconciliation/csv-mappings                     → list
POST   /api/v1/reconciliation/csv-mappings                     → CsvMapping
DELETE /api/v1/reconciliation/csv-mappings/{uuid}              → 204
```

### Endpoint de téléchargement

```python
@router.get("/statements/{uuid}/report/download")
async def download_reconciliation_report(
    uuid: UUID,
    format: str = "pdf",  # 'pdf' | 'json'
    db: AsyncSession = Depends(get_db),
    current_user = Depends(view_guard),
):
    """Force le téléchargement du rapport avec Content-Disposition: attachment."""
    statement = await service.get_statement(db, uuid)
    report_data = await service.get_report_data(db, uuid)
    filename = f"rapprochement_{statement.statement_date.strftime('%Y%m%d')}"

    if format == "json":
        return StreamingResponse(
            io.BytesIO(json.dumps(report_data, default=str).encode()),
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename={filename}.json"},
        )
    else:  # pdf
        pdf_bin = await service.generate_pdf_report(report_data)
        return Response(
            content=pdf_bin,
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename={filename}.pdf"},
        )
```

**Guards** : `view_guard` (lecture + téléchargement), `post_guard` (import/match/resolve/close), `settings_guard` (delete/csv-mappings).

---

## Phase G — Frontend

**Module** : `frontend/src/modules/reconciliation/` (séparé de `banque/`)

```
components/
├── ReconciliationImportPage.tsx       # Drag & drop — compte filtré Banque/Caisse
├── ReconciliationStatementList.tsx    # Liste relevés + progression
├── ReconciliationWorkspace.tsx        # Split panel banque ↔ GL
├── ReconciliationDiscrepancies.tsx    # Panneau des écarts
├── ReconciliationReport.tsx           # Rapport + boutons d'export
└── CsvMappingWizard.tsx               # Assistant mapping colonnes (avec champ date_format)
api/index.ts
types/index.ts
```

### Import

```
┌──────────────────────────────────────────────────────┐
│  Compte : [512100 - Crédit Mutuel ▼]                 │
│           (seuls les comptes Banque/Caisse affichés) │
│  Exercice : [2025/2026 ▼]                            │
│  ┌─────────────────────────────────────────────┐     │
│  │         📁 Glissez votre relevé ici          │     │
│  │    Formats : .ofx .qfx .csv .qif .940 .sta  │     │
│  └─────────────────────────────────────────────┘     │
│  Fichier : relevé_juin_2026.ofx                      │
│  ├── Format : OFX ✅                                 │
│  ├── Période : 01/06 → 30/06/2026                   │
│  ├── Lignes : 42                                     │
│  └── Soldes : 3 250 € → 7 500 €                     │
│              [⬇️ Importer]  [✕ Annuler]               │
└──────────────────────────────────────────────────────┘
```

### Workspace

```
┌─────────────────────────────────────────────────────┐
│  ████████████████░░░░░  72%                         │
│  ✅ 30 auto  🔵 2 manuel  🟡 6 à vérifier  ❌ 4    │
│                                                     │
│  ┌── Relevé Bancaire ──────┬── GL Banque/Caisse ──┐ │
│  │ 🟢 01/06  +1 000,00    │ 🟢 BQ-001 Virement   │ │
│  │ 🔵 02/06  +500,00      │ 🔵 BQ-002 (manuel)   │ │
│  │ 🟡 03/06  -52,30       │ 🔶 Aucune écriture   │ │
│  │ ❌ 05/06  +2 000,00    │ ❓ Aucune écriture   │ │
│  └─────────────────────────┴──────────────────────┘ │
│  [🔄 Re-matching]  [📋 Rapport]  [🔒 Clôturer]     │
└─────────────────────────────────────────────────────┘
```

### Rapport — Actions d'export (ReconciliationReport.tsx)

Bandeau d'actions après clôture :

```
[⬇️ Télécharger PDF]  [📋 Exporter JSON]
```

- **PDF** → `GET /report/download?format=pdf` → ouverture flux binaire
- **JSON** → `GET /report/download?format=json` → archivage / audit externe

---

## Phase H — Intégration & i18n

1. Ajouter route `/banque/reconciliation` dans le routeur (`react-router-dom v7`)
2. Ajouter onglet `reconciliation` dans `BanqueDailyOpsPage.tsx` avec badge si relevés en attente
3. i18n namespace `reconciliation.*` dans `fr.ts` / `en.ts`

---

## Dépendances backend

```
# backend/requirements.txt
ofxparse==0.21    # OFX/QFX
chardet==5.2.0    # Détection encodage CSV
reportlab>=4.0    # Génération PDF rapport (ou weasyprint selon préférence)
# python-multipart déjà présent
```

---

## Fichiers modifiés / créés

| Fichier | Action |
|---|---|
| `docs/migrations/046_bank_reconciliation.sql` | **Créer** |
| `backend/models.py` | **Modifier** — 3 nouveaux modèles (+ `date_format` sur `BankCsvMapping`) |
| `backend/schemas/reconciliation.py` | **Créer** |
| `backend/services/bank_parsers.py` | **Créer** |
| `backend/services/bank_reconciliation.py` | **Créer** |
| `backend/api/routes/reconciliation.py` | **Créer** |
| `backend/main.py` | **Modifier** — enregistrer le router |
| `backend/requirements.txt` | **Modifier** |
| `frontend/src/modules/reconciliation/` | **Créer** (6 composants + api + types) |
| `frontend/src/modules/banque/components/BanqueDailyOpsPage.tsx` | **Modifier** |
| `packages/i18n/src/resources/fr.ts` + `en.ts` | **Modifier** |

---

## Tests

### Backend

1. Import avec compte hors type 3/4 → `InvalidAccountError`
2. Parser OFX → lignes normalisées, FITID dédupliqués
3. Parser CSV avec `date_format='DD/MM/YYYY'` → pas d'inversion jour/mois
4. Parser CSV avec `date_format='MM/DD/YYYY'` → interprétation correcte
5. Matching → seules les écritures journaux type IN (3, 4) candidates
6. Matching exact → score 1.0 → auto-accept
7. Matching fuzzy ±3j → score 0.85 → auto-accept
8. Virement interne → score plafonné 0.60 → revue manuelle
9. Doublon SHA-256 → `DuplicateStatementError`
10. Association manuelle écriture hors type 3/4 → `InvalidEntryError`
11. Clôture avec lignes non résolues → refus + liste
12. Téléchargement PDF → `Content-Disposition: attachment; filename=rapprochement_*.pdf`
13. Téléchargement JSON → flux JSON valide avec toutes les données du rapport

### Frontend

14. Sélecteur compte → seuls Banque/Caisse affichés
15. Import OFX → aperçu → import → statut `imported`
16. Matching auto → progression → lignes colorées
17. Association manuelle → modale → 🔵
18. Clôture → refus si non résolu → résoudre → `reconciled`
19. Bouton PDF → téléchargement déclenché
20. Bouton JSON → téléchargement déclenché

---

## Décisions architecturales

| Décision | Choix | Raison |
|---|---|---|
| Périmètre matching | Journaux type IN (3, 4) uniquement | Seules les opérations Banque/Caisse sont rapprochables |
| Cardinalité | 1-à-1 stricte | Adapté aux flux pilotes (411 directs) et CE (écriture multi-lignes déjà ventilée) |
| `date_format` sur `BankCsvMapping` | Colonne explicite `VARCHAR(16)` default `'DD/MM/YYYY'` | Élimine le risque d'inversion jour/mois — correctif du bug historique |
| `accounting_lines` non modifiée | ✅ | Immutabilité des écritures postées, pas de duplication d'état |
| État rapprochement | Porté par `bank_statement_lines` | Source unique de vérité |
| FK vers `accounting_entries` | Pas de FK DB (app-layer) | PK composite `(uuid, fiscal_year_uuid)` — pattern existant |
| `matched_fiscal_year_uuid` | Stocké en clair | Reconstitue la référence composite sans JOIN |
| Téléchargement rapport | Route dédiée `/report/download?format=` | `Content-Disposition: attachment` — séparé de la route d'affichage UI |
| Statut `flagged` | Déclenché par `detect_discrepancies()` | Comportement explicite |
| Virement interne | Score plafonné à 0.60 | Évite les faux positifs à 1.0 |
| Sélecteur compte frontend | Filtré sur type IN (3, 4) | UX : empêche les erreurs de sélection |
