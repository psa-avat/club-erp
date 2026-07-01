# Module Comptabilité

## Principes généraux

La comptabilité de l'ERP est conforme au **PCG associatif français** :

- Comptabilité en partie double obligatoire (débit = crédit).
- Exercice fiscal explicite — non déduit de la date.
- Workflow brouillon → posté (les écritures postées sont immuables).
- Corrections par contre-passation uniquement.
- Précision monétaire : `NUMERIC(10,4)` en base, `Decimal` en application.

## Exercices fiscaux

| État | Code | Description |
|------|------|--------------|
| Ouvert | 1 | Exercice en cours |
| Clôturé | 2 | Exercice archivé |
| Réouvert | 3 | Exercice temporairement rouvert pour correction |

À la clôture d'un exercice, les soldes sont déversés dans l'exercice suivant via des écritures d'à-nouveau.

## Plan comptable

Le plan comptable suit la numérotation PCG (ex. : 4, 41, 411). Chaque compte peut être :
- **Postable** (réception d'écritures directes) ou de **regroupement**
- Marqué pour **lettrage** (rapprochement des débit/crédit)
- **Archivé** avec renvoi vers un compte de remplacement

## Journaux

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

## Saisie d'une écriture

1. Menu **Comptabilité → Écritures**.
2. Sélectionner le journal et l'exercice.
3. Saisir les lignes de débit et de crédit (la somme doit être équilibrée).
4. Enregistrer en **brouillon** pour révision, ou **poster** directement.

Des **modèles d'écritures** et des **opérations récurrentes** sont disponibles pour automatiser les saisies répétitives.

## Rapports financiers

- **Compte de résultat** : produits vs. charges de l'exercice
- **Bilan** : actif vs. passif à une date donnée
- **Grand livre** : historique complet par compte
- **Balance** : soldes débit/crédit par compte
- **Journal des vols** : détail des facturations de vols

## Fournisseurs

La gestion fournisseurs permet de :
- Enregistrer les factures fournisseurs
- Suivre les paiements
- Générer les écritures comptables correspondantes

## Ventes

Gestion des ventes directes aux membres (consommables, merchandising, etc.).

# Module Banque

## Comptes bancaires

L'ERP suit un ou plusieurs comptes bancaires du club. Chaque compte est lié à un compte du plan comptable (classe 5).

## Rapprochement bancaire

Le rapprochement permet de vérifier la cohérence entre les relevés bancaires et les écritures comptables. Les écarts sont signalés pour correction.
