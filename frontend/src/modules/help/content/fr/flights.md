# Module Vols

## Import depuis Planche

Les vols ne sont pas saisis directement dans l'ERP. Ils sont importés depuis **Planche** (application de terrain) qui fait office de source de vérité.

Processus :
1. Les vols sont saisis sur Planche par les responsables de terrain.
2. L'ERP **tire** (pull) les vols validés depuis Planche.
3. En cas de modification côté Planche, le vol est réimporté avec une révision.

## Types de vol

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

## Méthodes de lancement

| Code | Méthode |
|------|---------|
| 0 | Extérieur |
| 1 | Treuil |
| 2 | Remorqueur |
| 3 | Autonome |

## Cycle de vie d'un vol

```
importé → prévisualisé → appliqué (facturation brute)
        → remise calculée → posté
        → en correction → corrigé
```

# Facturation des vols & Packs

## Principe de facturation

La facturation respecte une architecture **brut d'abord, remise séparée** :

1. Chaque vol est facturé au **tarif brut standard** (journal FL).
2. Les remises issues des packs sont calculées séparément et centralisées dans un **journal REM** (une écriture de remise par pilote par période).

Cette séparation garantit un flux de revenus bruts auditables.

## Processus de facturation

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

## Résolution des tarifs

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

## Packs de vols

Un pack offre une remise sur les vols d'un pilote. Il est lié à un exercice fiscal et ne peut pas chevaucher deux exercices.

- Un pack peut être acheté **rétroactivement** dans l'année fiscale en cours.
- Le moteur de recalcul réévalue toutes les remises des vols non postés de l'année.
- Les soldes de pack non utilisés à la clôture de l'exercice sont **perdus** (aucun report).

## Corrections

Pour corriger une écriture déjà postée :
1. L'ERP crée une **contre-passation** (même montant, sens inversé).
2. Une nouvelle écriture de remplacement est créée.
3. Le vol passe en statut `corrigé`.
