# Spécification — Rôles et Capacités

> Référence : `backend/constants.py` · Version : 2026-07 (ajout `CAP_MANAGE_HR` manquant du catalogue et de la matrice)

---

## 1. Objectif

Ce document décrit le modèle d'autorisation de l'ERP : rôles prédéfinis, capacités granulaires, et règles d'attribution.

Le contrôle d'accès repose sur deux niveaux complémentaires :
- **Rôles** : ensembles de capacités nommés, configurés en base de données, faciles à assigner.
- **Capacités** : permissions atomiques vérifiées à chaque route API protégée.

Un utilisateur peut avoir plusieurs rôles et des capacités supplémentaires accordées individuellement.

---

## 2. Authentification

### 2.1 Niveaux d'authentification

| Niveau | Code | Description |
|--------|------|-------------|
| Pré-authentifié | 1 | Email + mot de passe validés, en attente du code PIN |
| Pleinement authentifié | 2 | PIN validé (ou appareil de confiance), session active |

### 2.2 Paramètres 2FA

| Paramètre | Valeur |
|-----------|--------|
| Longueur du PIN | 6 chiffres |
| Durée de validité du PIN | 15 minutes |
| Tentatives maximales | 5 |
| Durée mémorisation appareil de confiance | 30 jours |
| Cookie appareil de confiance | `trusted_device` |

---

## 3. Rôles prédéfinis

Les rôles sont ensemencés en base de données à l'initialisation. Leur code numérique est stable et ne doit pas être modifié.

| Code DB | Slug | Libellé | Périmètre typique |
|---------|------|---------|-------------------|
| 1 | `admin` | Administrateur | Toutes les fonctions sans restriction |
| 2 | `member` | Membre | Portail membre uniquement |
| 3 | `finance` | Finance | Comptabilité, tarifs, facturation vols |
| 4 | `instructor` | Instructeur | Vols, VI, planification |
| 5 | `maintenance` | Maintenance | Aéronefs et équipements |

Les rôles sont configurables : un administrateur peut créer des rôles supplémentaires depuis **Admin → Rôles**.

---

## 4. Capacités

Les capacités sont les permissions atomiques. Chaque route API protégée déclare la capacité requise via `require_capability(CAP_*)`.

### 4.1 Catalogue des capacités

| Constante Python | Code DB | Libellé |
|------------------|---------|---------|
| `CAP_EDIT_FLIGHTS` | `EDIT_FLIGHTS` | Gestion des vols |
| `CAP_MANAGE_PRICES` | `MANAGE_PRICES` | Gestion des tarifs |
| `CAP_VIEW_FINANCIALS` | `VIEW_FINANCIALS` | Lecture finance |
| `CAP_POST_ACCOUNTING_ENTRIES` | `POST_ACCOUNTING_ENTRIES` | Validation des écritures comptables |
| `CAP_MANAGE_ACCOUNTING_SETTINGS` | `MANAGE_ACCOUNTING_SETTINGS` | Paramétrage comptable |
| `CAP_MANAGE_SYSTEM_SETTINGS` | `MANAGE_SYSTEM_SETTINGS` | Paramétrage système |
| `CAP_MANAGE_USERS` | `MANAGE_USERS` | Gestion des utilisateurs |
| `CAP_MEMBER_PORTAL` | `MEMBER_PORTAL` | Accès portail membre |
| `CAP_MANAGE_ASSETS` | `MANAGE_ASSETS` | Gestion des aéronefs et équipements |
| `CAP_MANAGE_PLANCHE` | `MANAGE_PLANCHE` | Gestion Planche (pilotes, machines, VI) |
| `CAP_HELLOASSO` | `HELLOASSO` | Accès HelloAsso |
| `CAP_MANAGE_VI` | `MANAGE_VI` | Gestion des bons VI |
| `CAP_PLAN_VI` | `PLAN_VI` | Planification des vols d'initiation |
| `CAP_SYNC_VI_PLANCHE` | `SYNC_VI_PLANCHE` | Synchronisation VI vers Planche |
| `CAP_FEDERAL_SYNC` | `FEDERAL_SYNC` | Synchronisation fédérale (GesAsso / OSRT) |
| `CAP_MANAGE_HR` | `MANAGE_HR` | Gestion RH (profils, congés, présences) |
| `CAP_SEND_MEMBER_EMAILS` | `SEND_MEMBER_EMAILS` | Envoi d'emails aux adhérents (récapitulatifs) |

### 4.2 Matrice rôle / capacité recommandée

| Capacité | admin | finance | instructor | maintenance | member |
|----------|:-----:|:-------:|:----------:|:-----------:|:------:|
| `EDIT_FLIGHTS` | ✓ | | ✓ | | |
| `MANAGE_PRICES` | ✓ | ✓ | | | |
| `VIEW_FINANCIALS` | ✓ | ✓ | | | |
| `POST_ACCOUNTING_ENTRIES` | ✓ | ✓ | | | |
| `MANAGE_ACCOUNTING_SETTINGS` | ✓ | ✓ | | | |
| `MANAGE_SYSTEM_SETTINGS` | ✓ | | | | |
| `MANAGE_USERS` | ✓ | | | | |
| `MEMBER_PORTAL` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `MANAGE_ASSETS` | ✓ | | | ✓ | |
| `MANAGE_PLANCHE` | ✓ | | ✓ | | |
| `HELLOASSO` | ✓ | ✓ | | | |
| `MANAGE_VI` | ✓ | | ✓ | | |
| `PLAN_VI` | ✓ | | ✓ | | |
| `SYNC_VI_PLANCHE` | ✓ | | ✓ | | |
| `FEDERAL_SYNC` | ✓ | ✓ | | | |
| `MANAGE_HR` | ✓ | | | | |
| `SEND_MEMBER_EMAILS` | ✓ | ✓ | | | |

> Cette matrice est indicative. L'affectation réelle se configure dans **Admin → Rôles → Capacités**.

---

## 5. Modèle de données

```
User (1) ──── (*) UserRole (*) ──── (1) Role
User (1) ──── (*) UserCapability (*) ──── (1) Capability
Role (1) ──── (*) RoleCapability (*) ──── (1) Capability
```

Un utilisateur hérite des capacités de tous ses rôles, plus toute capacité attribuée individuellement.

La vérification effective en backend est :

```python
# backend/api/security.py
require_capability(CAP_EDIT_FLIGHTS)
# → vérifie que l'utilisateur courant possède cette capacité
#   (via rôle ou attribution directe)
```

---

## 6. Navigation frontend conditionnelle

Les entrées du menu latéral sont affichées ou masquées selon les capacités de l'utilisateur connecté, via le champ `requiredCapability` défini dans `frontend/src/shell/navigation.ts`.

Exemple :
```typescript
{ label: 'Tarifs', path: '/workspace/tarifs', requiredCapability: 'MANAGE_PRICES' }
```

Un utilisateur sans la capacité ne voit pas l'entrée de menu et ne peut pas accéder à la route (double protection : navigation + API).

---

## 7. Évolution

Pour ajouter une nouvelle capacité :

1. Ajouter la constante dans `backend/constants.py` (`CAP_*` + `CAPABILITY_SEEDS`).
2. Créer une migration SQL dans `docs/migrations/` pour insérer la nouvelle ligne dans `capabilities`.
3. Affecter la capacité aux routes backend concernées via `require_capability(CAP_NEW)`.
4. Mettre à jour `frontend/src/shell/navigation.ts` pour les entrées de menu concernées.
5. Mettre à jour cette spécification.
