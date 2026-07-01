# PRD – Système de gestion club planeur (tarification, comptabilité, portail pilotes)

## 1. Objectif

Mettre en place un système backend + frontend permettant de :

* gérer la tarification des activités (vols, cotisations, produits)
* suivre les comptes des pilotes (comptabilité simplifiée)
* produire des relevés / factures à la demande
* s’intégrer avec une API existante de planche de vol

---

## 2. Périmètre fonctionnel

### Inclus

* Import manuel des vols validés depuis l’API planche
* Calcul des tarifs (vols, packs, remorqués, treuils, produits)
* Génération d’écritures comptables
* Suivi du compte pilote (tiers 411)
* Portail pilote (consultation compte + historique)
* Backoffice trésorier

### Exclu (V1)

* TVA
* Facturation réglementaire complexe
* Synchronisation temps réel
* Multi-devises

---

## 3. Architecture globale

### 3.1 Composants

* API Planche (existante) → source de vérité des vols
* Backend Finance (nouveau)

  * tarification
  * comptabilité
* Base de données (SQLite → PostgreSQL évolutif)
* Frontends :

  * planche (existant)
  * admin planche (existant)
  * portail pilote (nouveau)
  * backoffice trésorier (nouveau)

---

### 3.2 Flux principal

```text
Planche API → Import manuel → Tarification → Écriture comptable → Consultation pilote
```

---

## 4. Choix techniques

### Backend

* FastAPI
* SQLAlchemy
* SQLite (V1)

### Frontend

* Flutter (web + mobile)

### Authentification

* V1 : JWT interne (table users)
* V2 : migration vers IdP (Keycloak possible)

---

## 5. Modèle comptable

### 5.1 Principe

* Comptabilité en double entrée
* Pas de factures stockées
* Écritures générées directement

---

### 5.2 Structure

#### Tables principales

* `accounts`
* `journal_entries`
* `entry_lines`
* `journals`
* `third_parties` (pilotes)

---

### 5.3 Journaux

* VEN : ventes (vols)
* BAN : banque

---

### 5.4 Brouillard

* implémenté via `status`

  * draft
  * posted
* pas de table séparée

---

### 5.5 Règles

* débit = crédit obligatoire
* immutabilité après validation
* correction par contrepassation
* numérotation à la validation

---

## 6. Modèle métier

### 6.1 Vols

* importés depuis API externe
* stockés localement
* non modifiables côté finance

---

### 6.2 Tarification

#### 6.2.1 Cotisations / forfaits

* dépend âge (<25 / ≥25)
* dépend période

#### 6.2.2 Vols

* tarif par machine
* 2 modes :

  * sans pack
  * avec pack

---

### 6.3 Packs

* unité : 25h
* consommés progressivement
* ≥ 5 packs → tarif pack illimité

#### Cas particulier

* achat possible après vol
* recalcul autorisé avant validation

---

### 6.4 Lancements

#### Treuil

* prix dépend durée vol

#### Remorqué

* facturation au 1/100h
* tarification par tranche

---

### 6.5 Produits annexes

* prix fixe
* structure simple

---

### 6.6 Vols d’initiation

* prix de vente
* coût interne
* delta analysable (compte spécifique)

---

## 7. Pipeline de traitement

```text
Flight (import)
    ↓
Pricing (calcul)
    ↓
Journal Entry (compta)
    ↓
Consultation pilote
```

---

## 8. Stockage des résultats

### Table clé

`flight_pricing`

* total_price
* breakdown_json (détail calcul)
* horodatage

### Règle

* prix figé après validation
* jamais recalculé

---

## 9. Gestion des pilotes (tiers)

* compte 411 unique
* relation via `third_party_id`
* pas de compte par pilote

---

## 10. Relevé / Facture

### Choix

* pas de table `invoice`

### Fonctionnement

* génération à la demande à partir des écritures

### Contenu

* historique des opérations
* solde
* détail par vol

---

## 11. Portail pilote

### Fonctionnalités

* consultation du solde
* historique des vols
* détail des calculs
* export PDF (relevé)

---

## 12. Backoffice

### Fonctionnalités

* import manuel des vols
* simulation tarification
* validation (brouillard → posted)
* gestion packs
* consultation comptes

---

## 13. Règles critiques

* ne jamais modifier une écriture validée
* ne jamais recalculer un prix validé
* ne jamais modifier les données de la planche
* tracer toute origine (flight_id)

---

## 14. Évolutions futures

* ajout TVA
* facturation officielle
* SSO (Keycloak)
* PostgreSQL
* analytics avancés
* automatisation synchronisation

---

## 15. Résumé des choix clés

| Sujet       | Choix                                 |
| ----------- | ------------------------------------- |
| Backend     | FastAPI                               |
| DB          | SQLite                                |
| Front       | Flutter                               |
| Facturation | pas de table invoice                  |
| Compta      | double entrée                         |
| Brouillard  | statut                                |
| Packs       | logique simple + décision utilisateur |
| Tarifs      | configurables en DB                   |
| Intégration | import manuel API planche             |

---

## 16. Conclusion

Le système vise :

* simplicité
* robustesse
* traçabilité
* évolutivité

Approche privilégiée :
➡️ **compta comme source de vérité financière**
➡️ **tarification configurable**
➡️ **fronts découplés**
➡️ **complexité maîtrisée**

Si tu veux, je peux transformer ce PRD en :

* backlog (user stories)
* schéma SQL exécutable
* ou skeleton de projet FastAPI 👍
