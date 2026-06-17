# Plan UX/UI — Navigation & Homogénéité (Club ERP)

> Date: 2026-06-17  
> Auteur: Claude Sonnet 4.6  
> Statut: Proposition — à valider avant implémentation

---

## 1. Diagnostic de l'existant

### 1.1 Structure actuelle (15+ entrées de navigation)

| # | Entrée nav | Route | Problème |
|---|---|---|---|
| 0 | Dashboard | `/dashboard` | OK |
| 1 | Vols & Facturation | `/workspace/flights` | OK |
| 2 | VI & HelloAsso | `/workspace/vi` | OK |
| 3 | Planning | `/planning` | OK |
| 4 | Membres | `/workspace/members` | OK |
| **5** | **Portail membres** | `/member-portal/workspace` | **À supprimer** — accès externe, auth séparée |
| 6 | Ventes | `/workspace/sales` | Finance fragmentée |
| 7 | Achats | `/workspace/purchases` | Finance fragmentée |
| 8 | Banque | `/workspace/finance` | Finance fragmentée |
| 9 | RH | `/workspace/rh` | OK |
| 10 | Comptabilité | `/workspace/accounting` | Finance fragmentée |
| 11 | Machines | `/workspace/machines` | OK |
| 12 | Tarifs | `/pricing` → `/banque/pricing` | Finance fragmentée + route incohérente |
| **13** | **Bilans** | `/workspace/accounting?tab=rapports` | **Doublon** de Comptabilité |
| 14 | Intégrations | `/planche` | Mélange opérationnel / config |
| 15 | Administration | `/admin` | OK mais incomplet |

### 1.2 Problèmes identifiés

**Fragmentation Finance (6 entrées pour un seul domaine)**
- `FinanceWorkspacePage` (`/workspace/finance`) — aperçu bancaire, opérations, packs, récurrents, rapprochement
- `BanqueWorkspacePage` (`/workspace/banque`) — journal, exercices, PCG, rapports, paramètres
- `AccountingWorkspacePage` (`/workspace/accounting`) — quasi-identique à banque, set de tabs différent
- `SalesWorkspacePage` (`/workspace/sales`) — facturation membres, factures, paiements
- `PurchasesWorkspacePage` (`/workspace/purchases`) — factures fournisseurs, répertoire fournisseurs
- `BankPricingPage` (`/banque/pricing`) — grille tarifaire bancaire par exercice

**Concept « Tarifs » éclaté en trois endroits**
- `/workspace/finance?tab=packs` — définitions de packs (catalogue produits / pricing)
- `/pricing` → `/banque/pricing` — grille de tarification bancaire
- `/workspace/machines?tab=tarifs` — tarification des machines

**Portail membres dans le menu staff**
Le composant `shellNavItems` (ligne 80–90, `navigation.ts`) expose `/member-portal/workspace` à priorité #5 dans la sidebar ERP. C'est une interface à authentification séparée (sessionStorage), destinée exclusivement aux membres — elle ne doit pas figurer dans le menu principal.

**Tab `packs` mal nommé sous Finance**
`/workspace/finance?tab=packs` contient les _définitions de packs_ (catalogue de produits et tarifs), pas des opérations sur packs. Le label induit en erreur.

**Doublon « Bilans »**
L'entrée #13 (`/workspace/accounting?tab=rapports`) pointe vers un sous-onglet déjà accessible depuis l'entrée #10 (Comptabilité).

**Double headers — deux patterns identifiés**

Pages rendant un second header à l'intérieur d'un tab `WorkspaceShell` (qui a déjà un `PageHeader`) :

| Composant | Contexte | Pattern | Impact |
|---|---|---|---|
| `MemberSheetsPage` | Tab dans `MembersWorkspacePage` | `ClubPageShell` — hero banner complet + sous-nav | Double header + double nav |
| `MembersListPage` | Tab dans `MembersWorkspacePage` | `PageHeader` de `@club-erp/ui` | Double header |
| `CommitteesManagementPage` | Tab dans `MembersWorkspacePage` | `PageHeader` de `@club-erp/ui` | Double header |
| `MemberFormPage` | Route standalone `/club/members/new` | `ClubPageShell` | Pas de double header — incohérence de style uniquement |

`ClubPageShell` lui-même est un composant legacy avec : hero banner (titre H1, description), sélecteur d'année, et sous-nav avec des `NavLink` vers des routes `/club/*` (déjà des redirects). Il doit être supprimé.

**Clés i18n workspace incomplètes**

Les workspace pages utilisent `t("workspace.x.tabs.y", "fallback FR")`. Les clés existent partiellement dans les namespaces (`banque`, `members`, `flights`), mais avec des gaps :
- `SalesWorkspacePage` utilise `tabs.entries`, `tabs.invoices`, `tabs.payments` — absents de `fr.ts` et `en.ts`
- Les fallbacks sont tous en français → l'interface ne peut pas passer en anglais pour ces labels
- `BanqueWorkspacePage` et `AccountingWorkspacePage` utilisent des namespaces différents (`workspace.banque.*` vs `workspace.accounting.*`) pour des tabs quasi-identiques
- `FlightsWorkspacePage` et `ViWorkspacePage` partagent le même préfixe `workspace.tabs.*` dans des namespaces différents (`flights` vs `vi`) — pas de conflit mais incohérence

**Tab « Fiches » redondant et mal nommé**
`MemberSheetsPage` (`/workspace/members?tab=fiches`) n'est pas une "fiche pilote" mais remplit deux rôles :
1. **Configuration annuelle du membre** : numéro de licence, type de tarif, heures de départ — données saisies une fois par an à l'inscription/réinscription.
2. **Gestion du token portail** : activation/désactivation/régénération du code d'accès au portail membre.

Ces deux rôles appartiennent à des endroits différents. Mettre les deux ensemble dans un tab de liste est un accident historique. `MemberPilotSheetPage` est déjà dépréciée (affiche un écran de redirection vers `MemberWorkspaceShell`) et peut être supprimée.

---

## 2. Architecture cible

### 2.1 Navigation (8 groupes vs 15 entrées)

```
Dashboard

── Opérations ──────────────────────────────────────────────────
  Vols & Facturation     /workspace/flights
    ├ Vols               (tab: vols)
    ├ Facturation        (tab: facturation — packs, GesAsso, OSRT)
    └ Sync Planche       (tab: sync)           [MANAGE_PLANCHE]

  VI / Bons VI           /workspace/vi
    ├ Bons VI            (tab: bons)
    ├ Types              (tab: types)
    ├ Planning           (tab: planning)
    ├ HelloAsso          (tab: achats, import)  [HELLOASSO]
    └ Sync Planche       (tab: sync)            [MANAGE_PLANCHE]

  Planning               /planning

── Membres ─────────────────────────────────────────────────────
  /workspace/members     [MANAGE_USERS]
    ├ Annuaire           (tab: annuaire)
    │   └ → /club/members/:uuid/workspace  (dossier individuel)
    │         ├ Carnet de vol   (logbook)
    │         ├ Solde & Compte  (balance + achats packs)
    │         ├ Dépenses club   (club-expenses)
    │         └ Accès portail   (token génération/révocation) ← déplacé depuis Fiches
    ├ Commissions        (tab: commissions)
    ├ Réinscription      (tab: reinscription — config annuelle : licence, tarif, heures)
    │                                         ← contenu de Fiches absorbé ici
    └ Sync Planche       (/planche/members-push)  [MANAGE_PLANCHE]

── Finance ─────────────────────────────────────────────────────
  /workspace/finance     [VIEW_FINANCIALS]  ← workspace unifié
    ├ Aperçu             (tab: apercu)
    ├ Opérations         (tab: operations — bancaires, récurrents, rapprochement)
    ├ Ventes             (tab: ventes — facturation membres, factures, paiements)
    ├ Achats             (tab: achats — factures fournisseurs, fournisseurs)
    ├ Tarifs             (tab: tarifs — définitions packs + grille bancaire)
    ├ Comptabilité       (tab: comptabilite — journal, exercices, PCG, rapports)
    └ Paramètres         (tab: parametres)   [MANAGE_SYSTEM_SETTINGS]

── Tarifs ───────────────────────────────────────────────────────
  /banque/pricing        [MANAGE_PRICES]
    ├ Grille tarifaire   (/banque/pricing — versions par exercice, tarifs non liés à un actif)
    ├ Packs              (/workspace/finance?tab=packs — catalogue de forfaits)
    └ Machines           (/workspace/machines?tab=tarifs — tarifs par aéronef)

── Machines ────────────────────────────────────────────────────
  /workspace/machines    [MANAGE_ASSETS]
    ├ Équipements        (tab: equipements)
    ├ Types              (tab: types)
    └ Sync Planche       (/planche/machines-push)  [MANAGE_PLANCHE]
    (Tarifs machine accessible depuis Tarifs > Machines)

── RH ──────────────────────────────────────────────────────────
  /workspace/rh
    ├ Planning congés    (tab: planning)
    ├ Présences          (tab: presences)
    └ Équipe             (tab: equipe)

── Administration ──────────────────────────────────────────────
  /admin                 [MANAGE_USERS]
    ├ Utilisateurs       (tab: users)
    ├ Rôles              (tab: roles)
    ├ Permissions        (tab: capabilities)
    ├ Journal d'audit    (tab: audit)
    └ Paramètres système (tab: settings)
          ├ Finance / Banque
          ├ HelloAsso
          ├ Planche (config + push membres + push machines)
          ├ GesAsso / OSRT
          └ Stockage
```

### 2.2 Routes et redirections

| Route actuelle | Cible | Type |
|---|---|---|
| `/workspace/sales` | `/workspace/finance?tab=ventes` | Redirect |
| `/workspace/purchases` | `/workspace/finance?tab=achats` | Redirect |
| `/workspace/banque` | `/workspace/finance?tab=comptabilite` | Redirect |
| `/workspace/accounting` | `/workspace/finance?tab=comptabilite` | Redirect |
| `/pricing` | `/workspace/finance?tab=tarifs` | Redirect |
| `/workspace/finance?tab=packs` | `/workspace/finance?tab=tarifs` | Rename tab |
| `/workspace/members?tab=fiches` | `/workspace/members?tab=reinscription` | Redirect + fusion |
| `/member-portal/workspace` | *(retiré de la sidebar)* | — |
| `/planche/members-push` | Membres > Sync Planche | Déplacement nav |
| `/planche/machines-push` | Machines > Sync Planche | Déplacement nav |

---

## 3. Détail des modifications

### Phase A — Quick wins ✅ TERMINÉ

**A1. Supprimer le Portail membres du menu**
- Fichier : `frontend/src/shell/navigation.ts`
- Supprimer l'entrée `{ to: '/member-portal/workspace', ... }` (lignes 79–90)
- Impact : aucun — la route `/member-portal/login` reste accessible directement

**A2. Supprimer le doublon Bilans**
- Fichier : `frontend/src/shell/navigation.ts`
- Supprimer l'entrée `{ to: '/workspace/accounting?tab=rapports', labelKey: 'nav.reports' }` (ligne 169)

**A3. Fusionner Intégrations dans Administration**
- Déplacer les enfants du groupe `nav.integrations` (lignes 175–181) dans les enfants de `nav.administration`
- Regrouper avec HelloAsso, Planche config, Storage (déjà dans Administration)
- Renommer le groupe en `nav.systemSettings` ou garder `nav.administration`

**A4. Créer le groupe Finance dans la sidebar**
- Remplacer les 5 entrées séparées (Ventes #6, Achats #7, Banque #8, Comptabilité #10, Tarifs #12) par une seule entrée groupe Finance
- Children : Aperçu, Opérations, Ventes, Achats, Tarifs, Comptabilité
- Routes cibles sur `/workspace/finance?tab=xxx`

**A5. Ajouter les i18n keys manquantes**
- Fichiers : `packages/i18n/src/resources/fr.ts`, `packages/i18n/src/resources/en.ts`
- Nouvelles clés : `nav.finance`, `nav.financeOverview`, `nav.financeOps`, `nav.financeVentes`, `nav.financeAchats`, `nav.financeTarifs`, `nav.financeComptabilite`
- Supprimer les clés devenues orphelines : `nav.banking`, `nav.sales`, `nav.purchases`, `nav.accounting`, `nav.pricing`, `nav.reports`, `nav.memberPortal`, `nav.portalDashboard`, etc.

---

### Phase B — Unification Finance ✅ TERMINÉ

**B1. Étendre `FinanceWorkspacePage`**
- Fichier : `frontend/src/modules/banque/components/FinanceWorkspacePage.tsx`
- Ajouter les tabs manquants en important les composants existants :
  - `tab: ventes` → importer `<SalesWorkspacePage />` content (ou ses sous-composants directs)
  - `tab: achats` → importer `<PurchasesWorkspacePage />` content
  - `tab: tarifs` → fusionner `<PackDefinitionsPage />` + lien vers `BankPricingPage`
  - `tab: comptabilite` → importer `<AccountingWorkspacePage />` content (journal, exercices, PCG, rapports)
  - `tab: parametres` → déjà dans `BanqueWorkspacePage` (à déplacer)

**B2. Ajouter les routes de redirection dans `App.tsx`**
```tsx
// Finance consolidation redirects
<Route path="/workspace/sales" element={<Navigate replace to="/workspace/finance?tab=ventes" />} />
<Route path="/workspace/purchases" element={<Navigate replace to="/workspace/finance?tab=achats" />} />
<Route path="/workspace/banque" element={<Navigate replace to="/workspace/finance?tab=comptabilite" />} />
<Route path="/workspace/accounting" element={<Navigate replace to="/workspace/finance?tab=comptabilite" />} />
```

**B3. Renommer le tab `packs` → `tarifs` dans `FinanceWorkspacePage`**
- Changer la clé de tab de `packs` à `tarifs`
- Mettre à jour `navigation.ts` : `?tab=packs` → `?tab=tarifs`
- Mettre à jour la route `/pricing` → `/workspace/finance?tab=tarifs`

**B4. Déprecation des workspace pages redondantes**
- `SalesWorkspacePage`, `PurchasesWorkspacePage`, `AccountingWorkspacePage`, `BanqueWorkspacePage` deviennent soit :
  - Des wrappers fins autour des sous-composants (pour réutilisabilité éventuelle), ou
  - Supprimées si aucune autre route ne les référence après redirections

---

### Phase C — Restructuration dossier membre ✅ TERMINÉ (C2 déféré Phase 10)

**C1. Supprimer le tab Fiches de `MembersWorkspacePage`**
- Fichier : `frontend/src/modules/members/components/MembersWorkspacePage.tsx`
- Retirer le tab `fiches` de la définition des tabs
- Ajouter un redirect dans `App.tsx` : `/workspace/members?tab=fiches` → `/workspace/members?tab=reinscription`

**C2. Absorber la config annuelle dans le tab Réinscription**
- Fichier : `frontend/src/modules/members/components/MembersWorkspacePage.tsx` (tab `reinscription`)
- Intégrer les champs `licence_number`, `fare_type`, `hours_count` issus de `MemberSheetsPage` dans le flux de réinscription annuelle
- Ces données partagent le même cycle de vie (saisie une fois par an lors de l'adhésion/renouvellement)
- `hours_count` : envisager de le calculer automatiquement depuis le carnet de vol si les données sont disponibles, ou le conserver comme champ de saisie manuelle d'initialisation

**C3. Déplacer la gestion du token portail dans le dossier membre**
- Fichier : `frontend/src/modules/members/components/MemberWorkspaceShell.tsx`
- Ajouter un tab ou une section `Accès portail` dans le dossier membre individuel (`mode="club"` uniquement)
- Contenu : statut d'activation, bouton générer/régénérer token, bouton désactiver
- La logique existe déjà dans `MemberSheetsPage` — la déplacer dans `MemberWorkspaceShell`
- Avantage : l'action est contextualisée sur un seul membre, pas sur une liste

**C4. Supprimer `MemberPilotSheetPage`**
- Fichier : `frontend/src/modules/members/components/MemberPilotSheetPage.tsx`
- Ce composant est déjà un écran de redirection vers `MemberWorkspaceShell` (déprecation déjà actée dans le code)
- Remplacer la route dans `App.tsx` par un `<Navigate>` direct vers `/club/members/:memberUuid/workspace`
- Supprimer le fichier composant

**C5. Affordance « Ouvrir le dossier » dans l'annuaire**
- Fichier : `frontend/src/modules/members/components/MemberDirectoryTable.tsx`
- Ajouter un bouton / clic de ligne pour naviguer vers `/club/members/:uuid/workspace`

**C6. Labellisation claire des tabs du dossier membre**
- Fichier : `frontend/src/modules/members/components/MemberWorkspaceShell.tsx`
- S'assurer que les tabs sont libellés explicitement :
  - `logbook` → "Carnet de vol"
  - `balance` → "Solde & Compte"
  - `club-expenses` → "Dépenses club"
  - `portal-access` → "Accès portail" *(nouveau, mode club uniquement)*

**C7. Bouton « Voir comme le membre » (optionnel, Phase ultérieure)**
- Sur le dossier membre en mode `club`, ajouter un lien vers `/member-portal/login`
- Utile pour que le staff prévisualise ce que voit le membre dans son portail

---

### Phase D — Administration étendue ✅ TERMINÉ

- `AdminPage` étend avec tab `parametres` contenant `SubWorkspaceShell` (helloasso, planche, stockage)
- Redirects : `/helloasso/integration` → `/admin?tab=parametres&subtab=helloasso`, `/planche/integration` → `...&subtab=planche`, `/storage/settings` → `...&subtab=stockage`
- BanqueSettingsPage reste dans `/workspace/finance?tab=parametres` (lien séparé dans nav Administration)
- i18n : ajout `admin.tabs.settings`, `admin.settings.{helloasso,planche,storage}` en fr+en

---

### Phase E — Suppression double headers + audit i18n ✅ TERMINÉ

> Règle : **les composants rendus à l'intérieur d'un tab `WorkspaceShell` ne doivent pas avoir leur propre header de page.** Titres et descriptions vivent dans la définition du tab au niveau du workspace. Les contenus de tabs commencent directement par leur contenu fonctionnel (tableau, formulaire, KPIs).

**E1. Supprimer `ClubPageShell` de `MemberSheetsPage`**
- `MemberSheetsPage` est un tab de `MembersWorkspacePage` → remplacer `<ClubPageShell>` par un `<div>` ou `<section>` simple
- Retirer l'import de `ClubPageShell`
- Le sélecteur d'année (`selectedYear`) doit migrer vers un composant partagé ou remonter dans le tab Réinscription (Phase C2)

**E2. Supprimer `PageHeader` de `MembersListPage`**
- Fichier : `frontend/src/modules/members/components/MembersListPage.tsx`
- Retirer le `<PageHeader ... />` (et son import)
- Titre/description/actions de cette vue vivent dans la définition du tab `annuaire` dans `MembersWorkspacePage`
- Si des actions (ex : bouton « Nouveau membre ») sont dans le PageHeader, les déplacer dans la prop `actions` du tab workspace ou en bouton inline dans le contenu

**E3. Supprimer `PageHeader` de `CommitteesManagementPage`**
- Fichier : `frontend/src/modules/members/components/CommitteesManagementPage.tsx`
- Même traitement que E2

**E4. Supprimer `ClubPageShell` de `MemberFormPage`**
- Fichier : `frontend/src/modules/members/components/MemberFormPage.tsx`
- `MemberFormPage` est une route standalone (`/club/members/new`, `/club/members/:uuid/edit`)
- Remplacer `ClubPageShell` par le style standard des pages standalone : `WorkspaceShell` à un seul tab, ou un layout simple `<div className="mx-auto max-w-7xl ...">` avec `PageHeader` directement
- Avantage : cohérence avec les autres pages de formulaire standalone de l'app

**E5. Supprimer `ClubPageShell` définitivement**
- Une fois E1–E4 faits, vérifier qu'il n'y a plus aucun usage (`grep -r ClubPageShell`)
- Supprimer `frontend/src/modules/members/components/ClubPageShell.tsx`
- Retirer les clés i18n `members.hero.*` et `common.nav.club*` si devenues orphelines

**E6. Audit et complétion des clés i18n workspace**

Checklist par namespace :

| Namespace | Composant | Clés manquantes à ajouter |
|---|---|---|
| `banque` | `SalesWorkspacePage` | `workspace.sales.tabs.entries`, `workspace.sales.tabs.invoices`, `workspace.sales.tabs.payments` |
| `banque` | `FinanceWorkspacePage` | Vérifier `workspace.finance.tabs.*` (5 tabs) — compléter `en.ts` |
| `banque` | `BanqueWorkspacePage` | Vérifier `workspace.banque.tabs.*` — accents manquants (`Parametres` → `Paramètres`) |
| `banque` | `AccountingWorkspacePage` | `workspace.accounting.tabs.*` — redondant avec `banque.tabs.*` après unification Finance |
| `members` | `MembersWorkspacePage` | `workspace.members.tabs.sheets` → à supprimer après Phase C1 ; `workspace.members.description` à mettre à jour |
| `flights` | `FlightsWorkspacePage` | Vérifier `workspace.tabs.*` dans namespace `flights` vs `common` |
| `vi` | `ViWorkspacePage` | Vérifier `workspace.tabs.*` dans namespace `vi` — cohérence avec flights |

Règle de complétion : pour chaque clé présente dans `fr.ts`, la même clé doit exister dans `en.ts` avec une traduction anglaise (pas un copier-coller français).

**E7. Harmoniser les namespaces des tabs**

Les tabs workspace utilisent deux conventions différentes :
- `workspace.[section].tabs.[key]` (banque, members, assets, rh, purchases)  
- `workspace.tabs.[key]` (flights, vi)

Choisir une convention unique : `workspace.tabs.[key]` dans chaque namespace de module (`flights`, `vi`, `banque`, `members`, etc.) — pas de sous-namespace `[section]`. Cela simplifie les ajouts futurs.

---

### Phase D — Administration étendue

**D1. Étendre `AdminPage` avec tab Paramètres système**
- Fichier : `frontend/src/modules/admin/components/AdminPage.tsx`
- Ajouter tab `settings` contenant des sections :
  - Finance/Banque → `BanqueSettingsPage` (déjà existant à `/banque/settings/:section`)
  - HelloAsso → `HelloAssoIntegrationPage`
  - Planche → `PlancheIntegrationPage` + `PlancheMembersPushPage` + `PlancheMachinesPushPage`
  - Stockage → `StorageSettingsPage`

**D2. Mettre à jour les routes de redirection**
```tsx
<Route path="/planche/members-push" element={<Navigate replace to="/admin?tab=settings&section=planche" />} />
<Route path="/planche/machines-push" element={<Navigate replace to="/admin?tab=settings&section=planche" />} />
<Route path="/helloasso/integration" element={<Navigate replace to="/admin?tab=settings&section=helloasso" />} />
<Route path="/storage/settings" element={<Navigate replace to="/admin?tab=settings&section=storage" />} />
```

---

## 4. Portail membres — stratégie de réutilisation

Le pattern actuel est correct et doit être conservé :

```
MemberWorkspaceShell
  mode="club"   → auth ERP, lecture/écriture, accès staff
  mode="portal" → auth portal (sessionStorage), lecture seule, accès membre
```

**Règle de réutilisation :**
- Un seul composant `MemberWorkspaceShell` pour les deux contextes
- La prop `mode` pilote :
  - Quel client API utiliser (ERP vs portal)
  - Quels boutons d'action afficher (édition, facturation, notes admin)
  - Quels tabs exposer (le portail n'a pas besoin des tabs admin)
- Les pages du portail (`/member-portal/workspace`) restent sur leur propre shell (`PortalShell`) avec header et navigation distincts

**Ce qu'il ne faut pas faire :**
- Dupliquer les composants de tabs (logbook, balance) en versions portal/club séparées
- Conditionner l'affichage par `if (mode === 'portal')` partout — centraliser dans des props ou des slots

---

## 5. Cohérence UI (règles transversales)

### 5.1 Pattern workspace unifié
Toutes les sections principales utilisent `WorkspaceShell` avec :
- Header : titre + description (1 ligne)
- Tabs : label + icône lucide-react, URL persistée (`?tab=xxx`)
- Contenu : composant lazy-loaded par tab
- Actions optionnelles en haut à droite (bouton primaire max 1, secondaires max 2)

### 5.2 Nommage des tabs (conventions)
- Clés de tab en **minuscules sans accent** (ex: `comptabilite` pas `comptabilité`)
- Labels i18n en français accentué dans les fichiers de traduction
- Cohérence entre la clé URL (`?tab=xxx`) et la clé i18n (`nav.xxx` ou `tab.xxx`)

### 5.3 Capacités et visibilité
- Chaque groupe de navigation porte son `requiredCapability` au niveau parent
- Les enfants héritent sauf exception explicite (enfant avec `requiredCapability` plus restrictive)
- Ne pas dupliquer les guards dans le composant page si la nav les filtre déjà

### 5.4 Redirections legacy
- Toutes les anciennes routes (`/banque/*`, `/club/*`, `/assets/*`, etc.) restent comme redirects dans `App.tsx`
- Ne jamais supprimer une redirect sans vérifier les liens externes (emails, bookmarks)

---

## 6. Ordre d'implémentation recommandé

| Phase | Effort | Risque | Valeur |
|---|---|---|---|
| **A — Navigation** | 2–3h | Faible (config only) | Immédiat — sidebar claire |
| **E1–E5 — Suppression double headers** | 3–5h | Faible | UI cohérente, `ClubPageShell` supprimé |
| **E6–E7 — Audit i18n workspace** | 2–3h | Faible | App bilingue complète, clés cohérentes |
| **C1–C4 — Fiches → Réinscription + dossier** | 3–4h | Faible | Supprime un tab confus, token mieux placé |
| **C5–C6 — Dossier membre UX** | 1–2h | Faible | Accès logbook/solde visible |
| **B1–B3 — Finance unifié** | 1–2 jours | Moyen (refactor composants) | Grosse réduction cognitive |
| **B4 — Déprecation** | 2–4h | Faible après redirections | Nettoyage |
| **D — Admin étendu** | 1 jour | Faible | Meilleure séparation ops/config |
| **C7 — Preview portail** | 2–4h | Faible | Confort staff |

---

## 7. Ce qui ne change pas

- La logique de routing protégé (`ProtectedRoute` / `PublicOnlyRoute`)
- Le portail membres (`/member-portal/*`) — routes, auth, shell inchangés
- L'ordre de priorité opérationnel dans la nav (Vols > VI > Planning > Membres > Finance)
- Le pattern `WorkspaceShell` + tabs URL-persistés
- Les composants feuilles (formulaires, tableaux, dialogs) — seul le regroupement change
