# ERP Club — Spécification Principale

> Version : 2026-07 · Licence : AGPL-3.0

Ce document décrit la structure générale de l'ERP, les modules existants et le menu principal. Il sert de point d'entrée pour l'architecture fonctionnelle.

---

## Architecture technique

| Composant | Technologie |
|-----------|-------------|
| Base de données | PostgreSQL |
| Backend | Python + FastAPI |
| Frontend | React + Vite (TypeScript) |
| Stockage fichiers | S3 / RustFS |
| Conteneurs | Docker / Docker Compose |

---

## Outils externes intégrés

| Outil | Rôle |
|-------|------|
| **Planche** | Application de terrain pour la gestion des vols. L'ERP pousse membres, machines et bons VI ; Planche retourne les vols validés. |
| **GesAsso** | Logiciel fédéral de gestion des licences pilotes. Reçoit les vols validés. |
| **OSRT** | Logiciel fédéral de navigabilité. Reçoit les heures de vol par machine. |
| **HelloAsso** | Plateforme de vente en ligne des bons d'initiation. |
| **Click & Glide** | Gestion du planning d'activités (à alimenter par l'ERP ou à remplacer). |

---

## Modules

### Modules en production

| Module | Description |
|--------|-------------|
| `admin` | Gestion des utilisateurs, rôles, capacités, paramètres système, audit |
| `assets` | Inventaire des aéronefs et équipements, propriété, statut, amortissement |
| `banque` | Comptes bancaires, rapprochement |
| `club` | Paramètres généraux du club |
| `dashboard` | Tableau de bord KPI |
| `flights` | Import vols depuis Planche, suivi du cycle de vie |
| `flight_billing` | Facturation brute des vols, journal FL |
| `flight_packs` | Gestion et consommation des packs de vols, journal REM |
| `helloasso` | Import des bons VI vendus sur HelloAsso |
| `members` | Annuaire membres, inscriptions annuelles, comités |
| `member-portal` | Portail libre-service membre (carnet de vol, solde, dépenses) |
| `planche` | Configuration et synchronisation Planche |
| `pricing` | Versions de tarifs, lignes de tarif, packs tarifaires |
| `reporting` | Rapports financiers (résultat, bilan, grand livre, balance) |
| `storage` | Gestion des fichiers et pièces jointes |
| `vi` | Bons d'initiation, types de VI, planification |
| `accounting` | Plan comptable, exercices fiscaux, journaux, écritures, modèles, récurrents |
| `planning` | Planning d'activités et créneaux |
| `rh` | Ressources humaines (congés, planning, charges) |

### Modules planifiés (placeholders `PlaceholderPage` dans le routage frontend)

| Module | Description | Statut |
|--------|-------------|--------|
| `gesasso` | Synchronisation vols vers GesAsso | Planifié (placeholder Phase 8) — routes `/integrations/gesasso`, `/workspace/flights?tab=gesasso` |
| `federal_sync` | Synchronisation fédérale OSRT | Planifié (placeholder Phase 8) — routes `/integrations/osrt`, `/workspace/flights?tab=osrt` |
| `daily-ops` | Opérations journalières (alertes/tâches) | Planifié (placeholder Phase 10) — route `/daily-ops/alerts` |
| `integrations` | Vue centralisée des intégrations tierces | Planifié — pages GesAsso et OSRT toutes deux en placeholder Phase 8 ; pas de page de synthèse dédiée |
| Journal d'audit (admin) | Historique des actions et modifications | Planifié (placeholder Phase 11) — route `/admin/audit` |

---

## Fonctionnalités par domaine

### Gestion des membres

- Annuaire : membres actifs, temporaires, non-volants, pilotes externes, bénévoles, organisations, clients/fournisseurs
- Inscription annuelle avec génération d'écritures comptables
- Fiches membres : carnet de vol, solde, dépenses, documents
- Comités avec responsable, membres et budget
- Identification unique `ME<ANNÉE>-<NNNN>` / `EXT-<NNNN>` / `FO-<NNNN>`
- Synchronisation des membres vers Planche

### Gestion des aéronefs

- Types d'aéronefs avec catégorie et durée d'amortissement
- Fiches aéronefs : immatriculation, propriété (club / privé avec co-propriétaires), statut, suivi comptable
- États : Opérationnel, En maintenance, Hors service, Cédé, Vendu
- Synchronisation des aéronefs actifs vers Planche

### Vols et facturation

- Import des vols validés depuis Planche (pull avec gestion des révisions)
- Types de vols : instruction, solo, initiation, partage, passager, lâcher, supervisé, essai
- Méthodes de lancement : extérieur, treuil, remorqueur, autonome
- Facturation brut-d'abord + journal de remises séparé
- Résolution des tarifs par machine (planeur et machine de lancement)
- Workflow : importé → prévisualisé → appliqué → posté → corrigé
- Packs de vols avec consommation FIFO et recalcul rétroactif

### Vols d'initiation (VI)

- Types de VI avec tarif associé
- Import des bons vendus sur HelloAsso
- Planification avec affectation instructeur / appareil
- Synchronisation des bons actifs vers Planche

### Comptabilité

- Double entrée obligatoire, PCG associatif français
- Exercices fiscaux explicites (Ouvert, Clôturé, Réouvert)
- Journaux : VT, HA, BQ, CS, OD, AN, FL, REM
- Workflow brouillon → posté (corrections par contre-passation uniquement)
- Précision monétaire `NUMERIC(10,4)` (backend) / `decimal.js` (frontend)
- Modèles d'écritures et opérations récurrentes
- Rapports : compte de résultat, bilan, grand livre, balance

### Tarifs et prix

- Versions de tarifs par période et type d'aéronef
- États : Brouillon, Active, Archivée
- Lignes de tarif avec paliers progressifs
- Packs tarifaires liés à un exercice fiscal (non reportables)

### Portail membre

- Accès séparé de l'ERP administratif
- Carnet de vol personnel, solde, dépenses, bénévolat, packs disponibles
- Rechargement de compte (si activé)

### Administration

- Utilisateurs, rôles et capacités
- Paramètres des intégrations externes (Planche, HelloAsso, GesAsso, Email, OSRT)
- Stockage S3 / RustFS
- Journal d'audit *(placeholder Phase 11, route `/admin/audit` — non implémenté)*

---

## Menu principal (navigation frontend)

```
Dashboard
  └── Membres / Aéronefs / Vols / Comptabilité

Club
  ├── Membres
  │   └── Fiche membre (carnet / solde / dépenses / bénévolat / documents) → portail
  ├── Aéronefs
  │   ├── Types d'aéronefs
  │   └── Liste des aéronefs
  ├── Comités
  └── RH
      ├── Planning
      └── Congés

Vols
  ├── Vols (facturation)
  ├── Packs
  └── Vols d'Initiation
      ├── Types de VI
      ├── Bons VI
      └── Planning

Intégrations
  ├── Planche
  ├── HelloAsso
  ├── GesAsso
  └── OSRT

Comptabilité
  ├── Plan comptable
  ├── Exercices fiscaux
  ├── Banque
  │   ├── Comptes
  │   └── Rapprochement
  ├── Tarifs
  │   ├── Paramètres généraux
  │   ├── Types de vols
  │   └── Versions de tarifs (aéronef ou global)
  ├── Écritures
  │   ├── Modèles
  │   └── Opérations récurrentes
  ├── Journaux
  ├── Ventes
  ├── Fournisseurs
  │   └── Factures
  └── Rapports financiers
      ├── Compte de résultat
      └── Bilan

Admin
  ├── Utilisateurs / Rôles / Capacités
  ├── Paramètres
  │   ├── Stockage
  │   ├── Planche
  │   ├── HelloAsso
  │   ├── GesAsso
  │   ├── Email
  │   ├── OSRT
  │   └── Click & Glide
  └── Journal d'audit
```

---

## Documents de référence

| Document | Description |
|----------|-------------|
| `docs/README.md` | Index complet de la documentation |
| `docs/manual/USER_GUIDE.md` | Guide utilisateur complet |
| `docs/product/SPEC_ROLES_CAPABILITIES.md` | Rôles, capacités et autorisation |
| `docs/product/SPEC_MEMBERS.md` | Spécification module Membres |
| `docs/product/SPEC_ACCOUNTING.md` | Spécification module Comptabilité |
| `docs/product/SPEC_ASSETS.md` | Spécification module Aéronefs |
| `docs/product/SPEC_FLIGHTS_BILLING.md` | Spécification facturation vols |
| `docs/developer/ARCHITECTURE_GLOBAL_FISCAL_YEAR.md` | Architecture exercice fiscal |
| `frontend/DESIGN_SYSTEM.md` | Conventions UI/UX frontend |
| `deploy/README.md` | Déploiement et opérations |
| `docs/migrations/` | Historique des migrations SQL (001–054) |
