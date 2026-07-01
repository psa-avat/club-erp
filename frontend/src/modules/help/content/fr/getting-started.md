# Présentation générale

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

## Architecture et composants

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

## Connexion et authentification

### Première connexion

1. Accédez à l'URL de l'ERP fournie par votre administrateur.
2. Entrez votre adresse e-mail et votre mot de passe.
3. Un code PIN à 6 chiffres est envoyé par e-mail (valide 15 minutes, 5 tentatives maximum).
4. Saisissez ce code pour compléter la connexion (authentification à deux facteurs).

### Appareils de confiance

Après une connexion réussie, vous pouvez cocher **« Faire confiance à cet appareil »**. L'appareil est mémorisé 30 jours : le code PIN ne sera pas redemandé depuis cet appareil pendant cette période.

### Portail membre

Les membres du club accèdent à un portail séparé avec leurs propres identifiants. Ce portail est distinct de l'ERP administratif et offre un accès en lecture à leur carnet de vol, solde et dépenses.

## Rôles et permissions

L'accès aux fonctionnalités est contrôlé par des **rôles** et des **capacités** affectés à chaque compte utilisateur.

### Rôles prédéfinis

| Code | Nom | Périmètre habituel |
|------|-----|--------------------|
| `admin` | Administrateur | Accès complet à toutes les fonctions |
| `finance` | Finance | Comptabilité, tarifs, facturation |
| `member` | Membre | Portail membre uniquement |
| `instructor` | Instructeur | Vols, initiation, planification |
| `maintenance` | Maintenance | Aéronefs, équipements |

### Capacités disponibles

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
| `MANAGE_HR` | Gestion RH (profils, congés, présences) |

Un administrateur assigne les rôles et les capacités depuis le menu **Admin → Utilisateurs**.

## Navigation principale

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
