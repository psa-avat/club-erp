# Guide Utilisateur — ERP Club de Vol à Voile

> Version : 2026-06 · Licence : AGPL-3.0
>
> **Ce contenu est désormais intégré dans l'application** (Centre d'aide — icône "?" dans
> l'en-tête, ou `/help`), module par module :
> `frontend/src/modules/help/content/fr/*.md`. Ce fichier reste la référence hors-ligne mais
> n'est plus la source à éditer directement — modifiez les fichiers markdown du module `help`
> puis répercutez ici si une copie consolidée est nécessaire.

---

## Table des matières

1. [Présentation générale](#1-présentation-générale)
2. [Architecture et composants](#2-architecture-et-composants)
3. [Connexion et authentification](#3-connexion-et-authentification)
4. [Rôles et permissions](#4-rôles-et-permissions)
5. [Navigation principale](#5-navigation-principale)
6. [Module Membres](#6-module-membres)
7. [Module Aéronefs & Équipements](#7-module-aéronefs--équipements)
8. [Module Vols](#8-module-vols)
9. [Module Facturation des vols & Packs](#9-module-facturation-des-vols--packs)
10. [Module Vols d'Initiation (VI)](#10-module-vols-dinitiation-vi)
11. [Module Comptabilité](#11-module-comptabilité)
12. [Module Banque](#12-module-banque)
13. [Module Tarifs & Prix](#13-module-tarifs--prix)
14. [Portail Membre](#14-portail-membre)
15. [Intégrations externes](#15-intégrations-externes)
16. [Administration système](#16-administration-système)
17. [Tableau de bord](#17-tableau-de-bord)
18. [Questions fréquentes](#18-questions-fréquentes)

---

## 1. Présentation générale

L'ERP Club est un logiciel libre (AGPL-3.0) de gestion intégrale d'un club de vol à voile. Il couvre l'ensemble du cycle de vie du club :

- **Membres** : inscription annuelle, fiches de membre, comités
- **Aéronefs** : inventaire, suivi d'état, propriété privée / club
- **Vols** : import depuis Planche, facturation, packs de vols
- **Initiation** : bons VI, planification, import HelloAsso
- **Comptabilité** : grand livre, journaux, PCG associatif français, bilans
- **Banque** : suivi de comptes, rapprochement
- **Tarifs** : versions de tarifs par période et type d'appareil, packs tarifaires
- **Portail membre** : accès libre-service du pilote (carnet de vol, solde, dépenses)
- **Intégrations** : Planche, HelloAsso, GesAsso, OSRT, synchronisation fédérale

Le système est accessible depuis n'importe quel navigateur moderne. Il n'y a rien à installer côté utilisateur.

---

## 2. Architecture et composants

| Composant | Technologie | Rôle |
|-----------|-------------|------|
| Backend API | Python / FastAPI | Règles métier, persistance, authentification |
| Base de données | PostgreSQL | Source de vérité des données |
| Frontend | React / Vite / TypeScript | Interface utilisateur |
| Stockage fichiers | S3 / RustFS | Documents, pièces jointes |
| Conteneurs | Docker / Docker Compose | Déploiement VPS ou local |

**Outils externes intégrés :**

| Outil | Rôle |
|-------|------|
| **Planche** | Application de suivi des vols en temps réel (source de vérité vols) |
| **HelloAsso** | Vente de bons d'initiation en ligne |
| **GesAsso** | Logiciel fédéral — envoi des vols validés (licence pilote) |
| **OSRT** | Logiciel fédéral — envoi des heures de vol par machine (navigabilité) |
| **Click & Glide** | Gestion du planning d'activités |

---

## 3. Connexion et authentification

### 3.1 Première connexion

1. Accédez à l'URL de l'ERP fournie par votre administrateur.
2. Entrez votre adresse e-mail et votre mot de passe.
3. Un code PIN à 6 chiffres est envoyé par e-mail (valide 15 minutes, 5 tentatives maximum).
4. Saisissez ce code pour compléter la connexion (authentification à deux facteurs).

### 3.2 Appareils de confiance

Après une connexion réussie, vous pouvez cocher **« Faire confiance à cet appareil »**. L'appareil est mémorisé 30 jours : le code PIN ne sera pas redemandé depuis cet appareil pendant cette période.

### 3.3 Portail membre

Les membres du club accèdent à un portail séparé avec leurs propres identifiants. Ce portail est distinct de l'ERP administratif et offre un accès en lecture à leur carnet de vol, solde et dépenses.

---

## 4. Rôles et permissions

L'accès aux fonctionnalités est contrôlé par des **rôles** et des **capacités** affectés à chaque compte utilisateur.

### 4.1 Rôles prédéfinis

| Code | Nom | Périmètre habituel |
|------|-----|--------------------|
| `admin` | Administrateur | Accès complet à toutes les fonctions |
| `finance` | Finance | Comptabilité, tarifs, facturation |
| `member` | Membre | Portail membre uniquement |
| `instructor` | Instructeur | Vols, initiation, planification |
| `maintenance` | Maintenance | Aéronefs, équipements |

### 4.2 Capacités disponibles

| Capacité | Description |
|----------|-------------|
| `EDIT_FLIGHTS` | Gestion et correction des vols |
| `MANAGE_PRICES` | Création et modification des tarifs |
| `VIEW_FINANCIALS` | Lecture des données financières |
| `POST_ACCOUNTING_ENTRIES` | Validation (lettrage) des écritures comptables |
| `MANAGE_ACCOUNTING_SETTINGS` | Paramétrage comptable (journaux, comptes) |
| `MANAGE_USERS` | Gestion des utilisateurs et rôles |
| `MEMBER_PORTAL` | Accès au portail membre |
| `MANAGE_SYSTEM_SETTINGS` | Paramétrage système global |
| `MANAGE_ASSETS` | Gestion des aéronefs et équipements |
| `MANAGE_PLANCHE` | Administration Planche (pilotes, machines, VI) |
| `HELLOASSO` | Accès et import HelloAsso |
| `MANAGE_VI` | Gestion des bons VI |
| `PLAN_VI` | Planification des vols d'initiation |
| `SYNC_VI_PLANCHE` | Synchronisation des bons VI vers Planche |
| `FEDERAL_SYNC` | Synchronisation fédérale (GesAsso / OSRT) |

Un administrateur assigne les rôles et les capacités depuis le menu **Admin → Utilisateurs**.

---

## 5. Navigation principale

La barre de navigation latérale donne accès aux modules suivants :

```
Dashboard
Club
  ├── Membres
  ├── Aéronefs
  └── Comités
Vols
  ├── Vols (facturation)
  ├── Packs
  └── Vols d'Initiation
      ├── Types de VI
      ├── Bons VI
      └── Planning
Comptabilité
  ├── Plan comptable
  ├── Exercices fiscaux
  ├── Banque
  ├── Tarifs
  ├── Écritures & Modèles
  ├── Journaux
  ├── Ventes
  ├── Fournisseurs
  └── Rapports financiers
Intégrations
  ├── Planche
  ├── HelloAsso
  ├── GesAsso
  └── OSRT
Admin
  ├── Utilisateurs / Rôles / Capacités
  ├── Paramètres
  └── Journal d'audit
```

---

## 6. Module Membres

### 6.1 Vue d'ensemble

Le module Membres gère l'annuaire complet du club, les inscriptions annuelles et les comités.

### 6.2 Catégories de membres

| Catégorie | Description |
|-----------|-------------|
| Membre actif | Pilote pratiquant, inscrit à l'année |
| Membre temporaire | Inscription courte période |
| Membre non volant | Participe au club sans voler |
| Pilote externe | Pilote d'un autre club |
| Bénévole | Contribution au club sans vol |
| Organisation externe | Club ou association partenaire |
| Client/Fournisseur | Relation commerciale |

### 6.3 Drapeaux de rôle

Un membre peut cumuler plusieurs drapeaux : **Instructeur**, **Employé**, **Dirigeant**, **Membre du bureau**.

Règles métier :
- Un membre peut être à la fois instructeur et dirigeant.
- Un employé ne peut pas être simultanément dirigeant ou membre du bureau.

### 6.4 Identifiant membre

Chaque membre reçoit un identifiant métier unique :
- `ME<ANNÉE>-<NNNN>` pour les membres club (ex. : `ME2026-0042`)
- `EXT-<NNNN>` pour les pilotes externes et organisations
- `FO-<NNNN>` pour les clients/fournisseurs

Cet identifiant sert également d'identité dans le grand livre comptable.

### 6.5 Inscription annuelle

1. Ouvrir la fiche membre → onglet **Inscriptions**.
2. Cliquer **Nouvelle inscription**.
3. Sélectionner la catégorie et la période.
4. L'inscription génère automatiquement les écritures comptables correspondantes.

> Si l'inscription est réalisée à partir du 1er octobre, elle couvre également l'année suivante complète.

### 6.6 Fiche membre

La fiche membre regroupe :
- Informations d'identité et de contact
- Statut d'inscription courant
- Carnet de vol (résumé)
- Solde de compte
- Dépenses et frais bénévolat (déduction fiscale)
- Documents associés

### 6.7 Comités

Les comités regroupent des membres autour de missions spécifiques (sécurité, technique, événements…). Chaque comité dispose d'un responsable, d'une liste de membres et d'un budget.

---

## 7. Module Aéronefs & Équipements

### 7.1 Vue d'ensemble

Gère l'inventaire complet : planeurs, remorqueurs, treuils, remorques, réfections/grosses réparations, moteurs, parachutes, véhicules de piste, équipements de club (ex. tondeuse).

### 7.2 Familles d'actifs

Le modèle est à deux niveaux : **Famille → Actif** (les catégories ont été supprimées ; chaque famille porte directement ses comptes comptables).

Chaque famille définit :
- **Comptes comptables** : acquisition (classe 2), amortissement (classe 28), charge (classe 6), produit (classe 7). C'est l'unique endroit où ces comptes sont configurés — les actifs eux-mêmes ne portent aucun compte comptable propre, uniquement leurs données de prix et d'amortissement (voir §7.3).
- **Tarifée ou non** (`is_priced`) : indique si la famille porte un tarif de vol (versions tarifaires). La plupart des familles d'aéronefs et de treuils sont tarifées ; les familles purement comptables (remorques, réfections, moteurs, véhicules de piste, tondeuse) ne le sont généralement pas.
- La stratégie tarifaire, la durée d'amortissement standard (au niveau de chaque actif).

Exemples de familles reflétant l'usage réel d'un club : Aéronefs, Remorques, Peinture (réfection gelcoat), Grosses réparations, Parachutes, Moteurs, Treuils, Véhicules de piste, Tondeuse.

### 7.3 Fiche aéronef

| Champ | Description |
|-------|-------------|
| Immatriculation / Code | Identifiant unique (ex. : F-CGVX) |
| Famille | Référence à la famille d'actifs |
| Actif parent | Optionnel — pour un sous-composant (remorque, réfection, moteur) rattaché à un actif principal (voir §7.3bis) |
| Réservable pour les vols | Décoché pour un sous-composant qui ne doit ni apparaître dans la sélection de vol ni être poussé vers Planche |
| Propriété | Club ou Privé (avec co-propriétaires) |
| Statut | Opérationnel / En maintenance / Hors service / Cédé / Vendu |
| Prix d'acquisition | Valeur d'entrée |
| Amortissement | Date de début, durée, valeur résiduelle |

Note : la fiche actif ne contient plus de champ compte comptable — les comptes affichés (lecture seule) sont ceux de la famille de l'actif.

### 7.3bis Sous-composants d'un actif

Un actif « racine » (ex. un planeur) peut avoir des actifs « enfants » représentant des composants comptables distincts avec leur propre plan d'amortissement : remorque, réfection gelcoat/peinture, changement moteur. La hiérarchie est limitée à **2 niveaux** : un actif enfant ne peut pas lui-même avoir d'enfant.

Comme les comptes comptables ne se configurent qu'au niveau de la famille (§7.2), un sous-composant obtient ses propres comptes en étant rattaché à une famille différente de celle de son parent (ex. une remorque dans la famille « Remorques », distincte de « Aéronefs »). Pour un sous-composant qui doit poster sur le **même** compte que son parent (ex. une réfection gelcoat capitalisée sur le compte de l'aéronef), rattachez-le à la **même famille** que l'actif parent : il héritera alors automatiquement des mêmes comptes.

Exemple : le planeur F-CGVX (famille Aéronefs, tarifé, réservable) possède une remorque F-CGVX-REM en actif enfant (famille Remorques, non tarifée, non réservable), avec son propre prix d'achat et sa propre durée d'amortissement. Le total d'acquisition (planeur + remorque) et la liste des sous-composants sont visibles sur la fiche du planeur.

### 7.4 Propriété privée

Pour les planeurs privés, un ou plusieurs co-propriétaires membres sont enregistrés. La facturation des vols sur ces appareils génère un avertissement non bloquant si aucun tarif n'est configuré — ce message apparaît systématiquement pour toute famille marquée non tarifée (`is_priced = false`).

### 7.5 Statuts d'un aéronef

```
Opérationnel → En maintenance → Opérationnel
                              → Hors service → Cédé / Vendu
```

### 7.6 Synchronisation Planche

Seuls les actifs actifs, opérationnels **et réservables** sont automatiquement poussés vers **Planche** pour être disponibles lors de la saisie des vols. Les sous-composants (remorques, réfections, moteurs) ne sont jamais poussés.

### 7.7 Comptes comptables recommandés

Le plan comptable du club dispose déjà d'un modèle de comptes dédiés par actif pour les planeurs (`21821`/`281821`) et les avions/remorqueurs (`21822`/`281822`). Pour les autres familles, comptes à envisager (numérotation à confirmer avec le trésorier avant création) :

| Famille | Compte(s) existant(s) | Compte(s) proposé(s) si suivi individualisé souhaité |
|---|---|---|
| Aéronefs (planeurs) | `21821` / `281821` | — déjà adapté |
| Aéronefs (remorqueurs) | `21822` / `281822` | — déjà adapté |
| Treuils | `2154` / `28154` (partagé, non individualisé) | `21541` / `281541` |
| Remorques | `2182` / `28182` (partagé avec les véhicules de piste) | `21823` / `281823` |
| Véhicules de piste | `2182` / `28182` (partagé avec les remorques) | `21824` / `281824` |
| Moteurs (si suivis indépendamment) | aucun | `21825` / `281825` |
| Parachutes (si immobilisés) | aucun (sinon charge directe en 606) | `21826` / `281826` |
| Peinture / grosses réparations | — pas de nouvelle famille comptable : rattacher le sous-composant à la **même famille** que l'actif parent (ex. Aéronefs) pour hériter automatiquement de ses comptes | — |
| Tondeuse | `2188` / `288` (générique) | — suffisant pour un exemplaire unique |

---

## 8. Module Vols

### 8.1 Import depuis Planche

Les vols ne sont pas saisis directement dans l'ERP. Ils sont importés depuis **Planche** (application de terrain) qui fait office de source de vérité.

Processus :
1. Les vols sont saisis sur Planche par les responsables de terrain.
2. L'ERP **tire** (pull) les vols validés depuis Planche.
3. En cas de modification côté Planche, le vol est réimporté avec une révision.

### 8.2 Types de vol

| Code | Libellé |
|------|---------|
| 0 | Instruction |
| 1 | Solo |
| 2 | Initiation |
| 3 | Partage |
| 4 | Passager |
| 5 | Lâcher |
| 6 | Supervisé |
| 7 | Essai |

### 8.3 Méthodes de lancement

| Code | Méthode |
|------|---------|
| 0 | Extérieur |
| 1 | Treuil |
| 2 | Remorqueur |
| 3 | Autonome |

### 8.4 Cycle de vie d'un vol

```
importé → prévisualisé → appliqué (facturation brute)
        → remise calculée → posté
        → en correction → corrigé
```

---

## 9. Module Facturation des vols & Packs

### 9.1 Principe de facturation

La facturation respecte une architecture **brut d'abord, remise séparée** :

1. Chaque vol est facturé au **tarif brut standard** (journal FL).
2. Les remises issues des packs sont calculées séparément et centralisées dans un **journal REM** (une écriture de remise par pilote par période).

Cette séparation garantit un flux de revenus bruts auditables.

### 9.2 Processus de facturation

**Étape 1 — Prévisualisation**
- L'utilisateur sélectionne un ou plusieurs vols et clique **Prévisualiser**.
- L'ERP calcule le tarif applicable sans modifier la base de données.
- Un hash SHA-256 est calculé pour verrouiller la configuration tarifaire utilisée.

**Étape 2 — Application**
- L'utilisateur valide la prévisualisation en cliquant **Appliquer**.
- Une écriture brouillon est créée dans le journal FL :
  - Débit compte 411 (membre) / Crédit compte 706 (produit de vol)
- Les consommations de pack sont enregistrées (FIFO).

**Étape 3 — Ajustement remises (REM)**
- L'ERP calcule la remise nette à appliquer.
- Une écriture de remise est créée ou mise à jour dans le journal REM :
  - Débit compte 608 (charge escompte) / Crédit compte 411 (membre)

**Étape 4 — Validation (posting)**
- Le comptable revoit les écritures brouillon et les valide.
- Les écritures postées sont **immuables** : toute correction passe par une contre-passation + remplacement.

### 9.3 Résolution des tarifs

Pour chaque vol, l'ERP identifie jusqu'à deux machines facturables :

| Machine | Source |
|---------|--------|
| Planeur / TMG | Code aéronef du vol |
| Remorqueur / Treuil | Code machine de lancement |

Pour chaque machine, une **version de tarif active** est recherchée selon :
- Statut = Actif
- Date début ≤ date du vol ≤ date fin (ou pas de date fin)
- Type d'aéronef correspondant

Si aucune version n'est trouvée : **erreur bloquante** (sauf planeur privé → avertissement).

### 9.4 Packs de vols

Un pack offre une remise sur les vols d'un pilote. Il est lié à un exercice fiscal et ne peut pas chevaucher deux exercices.

- Un pack peut être acheté **rétroactivement** dans l'année fiscale en cours.
- Le moteur de recalcul réévalue toutes les remises des vols non postés de l'année.
- Les soldes de pack non utilisés à la clôture de l'exercice sont **perdus** (aucun report).

### 9.5 Corrections

Pour corriger une écriture déjà postée :
1. L'ERP crée une **contre-passation** (même montant, sens inversé).
2. Une nouvelle écriture de remplacement est créée.
3. Le vol passe en statut `corrigé`.

---

## 10. Module Vols d'Initiation (VI)

### 10.1 Présentation

Les vols d'initiation (VI) permettent à des non-membres de découvrir le vol à voile via l'achat d'un bon. Les bons sont vendus sur **HelloAsso** ou directement au club.

### 10.2 Types de VI

Chaque type de VI définit :
- Un intitulé et une description
- Une durée estimée
- Un tarif associé
- Les ressources nécessaires (instructeur, type d'appareil)

### 10.3 Cycle d'un bon VI

```
Vendu (HelloAsso / direct) → Importé dans l'ERP
→ Affecté à un créneau planning → Réalisé (vol effectué)
→ Synchronisé vers Planche → Facturé
```

### 10.4 Import HelloAsso

1. Menu **Intégrations → HelloAsso**.
2. Cliquer **Importer les commandes**.
3. L'ERP récupère les bons vendus et les crée dans le catalogue VI.

### 10.5 Planning VI

Le planning permet d'affecter des bons à des créneaux avec instructeur et planeur. Les informations sont synchronisées vers Planche pour la gestion de terrain.

---

## 11. Module Comptabilité

### 11.1 Principes généraux

La comptabilité de l'ERP est conforme au **PCG associatif français** :

- Comptabilité en partie double obligatoire (débit = crédit).
- Exercice fiscal explicite — non déduit de la date.
- Workflow brouillon → posté (les écritures postées sont immuables).
- Corrections par contre-passation uniquement.
- Précision monétaire : `NUMERIC(10,4)` en base, `Decimal` en application.

### 11.2 Exercices fiscaux

| État | Code | Description |
|------|------|-------------|
| Ouvert | 1 | Exercice en cours |
| Clôturé | 2 | Exercice archivé |
| Réouvert | 3 | Exercice temporairement rouvert pour correction |

À la clôture d'un exercice, les soldes sont déversés dans l'exercice suivant via des écritures d'à-nouveau.

### 11.3 Plan comptable

Le plan comptable suit la numérotation PCG (ex. : 4, 41, 411). Chaque compte peut être :
- **Postable** (réception d'écritures directes) ou de **regroupement**
- Marqué pour **lettrage** (rapprochement des débit/crédit)
- **Archivé** avec renvoi vers un compte de remplacement

### 11.4 Journaux

| Code | Type | Usage |
|------|------|-------|
| VT | Ventes | Cotisations, prestations |
| HA | Achats | Fournisseurs |
| BQ | Banque | Opérations bancaires |
| CS | Caisse | Espèces |
| OD | Opérations diverses | Ajustements |
| AN | À-nouveau | Report exercice précédent |
| FL | Vols | Facturation brute des vols |
| REM | Remises | Ajustements packs / remises vols |

### 11.5 Saisie d'une écriture

1. Menu **Comptabilité → Écritures**.
2. Sélectionner le journal et l'exercice.
3. Saisir les lignes de débit et de crédit (la somme doit être équilibrée).
4. Enregistrer en **brouillon** pour révision, ou **poster** directement.

Des **modèles d'écritures** et des **opérations récurrentes** sont disponibles pour automatiser les saisies répétitives.

### 11.6 Rapports financiers

- **Compte de résultat** : produits vs. charges de l'exercice
- **Bilan** : actif vs. passif à une date donnée
- **Grand livre** : historique complet par compte
- **Balance** : soldes débit/crédit par compte
- **Journal des vols** : détail des facturations de vols

### 11.7 Fournisseurs

La gestion fournisseurs permet de :
- Enregistrer les factures fournisseurs
- Suivre les paiements
- Générer les écritures comptables correspondantes

### 11.8 Ventes

Gestion des ventes directes aux membres (consommables, merchandising, etc.).

---

## 12. Module Banque

### 12.1 Comptes bancaires

L'ERP suit un ou plusieurs comptes bancaires du club. Chaque compte est lié à un compte du plan comptable (classe 5).

### 12.2 Rapprochement bancaire

Le rapprochement permet de vérifier la cohérence entre les relevés bancaires et les écritures comptables. Les écarts sont signalés pour correction.

---

## 13. Module Tarifs & Prix

### 13.1 Versions de tarifs

Les tarifs sont organisés en **versions** avec une période de validité (`date début` → `date fin`). Plusieurs versions peuvent coexister, mais une seule est active à tout moment pour un type d'aéronef donné.

**Périmètre d'une version :**
- **Global / cotisations** : tarifs non liés à un type d'appareil
- **Spécifique aéronef** : tarifs liés à un type d'appareil (planeur, remorqueur…)

**États d'une version :**
```
Brouillon → Active → Archivée
```

Une version verrouillée (`is_locked`) ne peut plus être modifiée.

### 13.2 Lignes de tarif

Chaque version contient des lignes définissant :
- Le type de vol concerné (instruction, solo, remorqué…)
- L'unité de facturation (durée, nombre de lancements…)
- Le tarif unitaire
- Des paliers progressifs (ex. : réduction après N heures)

**Règle de palier :** le palier applicable est le plus haut palier dont le seuil est inférieur ou égal à la consommation du membre.

### 13.3 Packs tarifaires

Un pack offre un crédit prépayé de vols à un tarif préférentiel. Caractéristiques :
- Lié à un exercice fiscal (pas de report possible)
- Applicable rétroactivement sur les vols de l'exercice
- Consommation en FIFO (premier pack acheté = premier utilisé)

---

## 14. Portail Membre

### 14.1 Accès

Chaque membre actif peut se connecter au portail avec ses propres identifiants (séparés des comptes ERP administratifs). L'URL est communiquée par le club.

### 14.2 Fonctionnalités disponibles

| Fonctionnalité | Description |
|----------------|-------------|
| Carnet de vol | Historique de tous ses vols avec durées et types |
| Solde de compte | Solde du compte membre en temps réel |
| Dépenses club | Frais engagés pour le club (déduction fiscale) |
| Dépenses bénévolat | Heures de bénévolat valorisées |
| Packs | Soldes de packs disponibles |
| Rechargement | Dépôt sur compte (si activé par le club) |
| Documents | Accès aux documents partagés |

---

## 15. Intégrations externes

### 15.1 Planche

Planche est l'application de terrain qui gère les vols en temps réel. L'ERP est la **source de vérité** pour les membres, machines et bons VI. Planche est la **source de vérité** pour les vols validés.

**Flux de données :**
```
ERP → Planche : membres, aéronefs, bons VI actifs
Planche → ERP : vols validés (import)
```

**Configuration :** Admin → Paramètres → Planche (URL, token API).

### 15.2 HelloAsso

HelloAsso est la plateforme de vente en ligne des bons VI.

1. Menu **Intégrations → HelloAsso**.
2. Configurer les clés API dans Admin → Paramètres.
3. Déclencher l'import pour récupérer les nouvelles commandes.

### 15.3 GesAsso

GesAsso est le logiciel fédéral de gestion des licences pilotes.

Après validation des vols dans l'ERP, ils peuvent être envoyés à GesAsso pour mise à jour des carnets de vol fédéraux. Requiert la capacité `FEDERAL_SYNC`.

### 15.4 OSRT

OSRT est le système fédéral de suivi de la navigabilité des aéronefs. Les heures de vol par machine lui sont transmises périodiquement.

---

## 16. Administration système

### 16.1 Utilisateurs, rôles et capacités

Menu : **Admin → Utilisateurs**

- Créer / modifier / désactiver des comptes utilisateurs
- Affecter des rôles prédéfinis
- Affiner les permissions avec des capacités individuelles
- Réinitialiser les mots de passe

### 16.2 Paramètres système

Menu : **Admin → Paramètres**

| Section | Description |
|---------|-------------|
| Stockage | Configuration S3 / RustFS pour les pièces jointes |
| Planche | URL et token de l'API Planche |
| HelloAsso | Clés API HelloAsso |
| GesAsso | Paramètres de connexion GesAsso |
| Email | Serveur SMTP pour les notifications |
| OSRT | Paramètres OSRT |
| Click & Glide | Paramètres planning activités |

### 16.3 Journal d'audit

Le journal d'audit trace toutes les actions sensibles (modifications de données, validations comptables, changements de configuration).

---

## 17. Tableau de bord

Le tableau de bord présente une vue synthétique de l'activité du club :

| Indicateur | Description |
|------------|-------------|
| Membres actifs | Nombre d'inscrits pour l'exercice en cours |
| Vols du mois | Nombre et heures de vols |
| Solde financier | Solde global des comptes |
| Bons VI | Bons vendus / réalisés / en attente |
| Alertes | Aéronefs en maintenance, écritures brouillon en attente |

---

## 18. Questions fréquentes

**Q : Un vol modifié sur Planche est-il automatiquement mis à jour dans l'ERP ?**
R : Non. Il faut déclencher manuellement un nouvel import depuis le menu Vols → Import Planche. Le vol est réimporté avec une révision, et si des écritures avaient déjà été créées, elles doivent être corrigées.

**Q : Que se passe-t-il si aucun tarif n'est configuré pour un vol ?**
R : La prévisualisation de facturation retourne une erreur bloquante. L'ERP ne peut pas appliquer la facturation tant qu'une version de tarif active et compatible n'existe pas pour la date du vol.

**Q : Peut-on acheter un pack après avoir déjà effectué des vols ?**
R : Oui. Un pack peut être acheté à tout moment dans l'exercice fiscal en cours. Le moteur de recalcul ré-applique automatiquement les remises sur tous les vols non postés de l'année.

**Q : Peut-on rouvrir un exercice fiscal clôturé ?**
R : Oui, un exercice peut être réouvert (état « Réouvert ») pour corrections. Les corrections sur des écritures postées passent toujours par contre-passation + nouvelle écriture.

**Q : Comment corriger une erreur dans une écriture comptable déjà postée ?**
R : Les écritures postées sont immuables. L'ERP génère automatiquement une contre-passation (écriture inverse) et une écriture de remplacement. Contacter le responsable comptable pour initier la correction.

**Q : Les soldes de packs non utilisés sont-ils reportés à l'année suivante ?**
R : Non. Les packs sont stritement liés à un exercice fiscal. Tout solde non consommé au 31 décembre est perdu.

**Q : Comment accéder au portail membre ?**
R : Le club communique une URL spécifique au portail. Les identifiants du portail sont distincts des identifiants ERP administratifs.

**Q : Qu'est-ce que l'identifiant `ME2026-0042` ?**
R : C'est l'identifiant métier unique du membre, généré automatiquement à la création. Il sert aussi de référence dans le grand livre comptable (compte 411).

---

*Document généré le 2026-06-23. Pour toute question, contacter l'administrateur ERP du club.*
