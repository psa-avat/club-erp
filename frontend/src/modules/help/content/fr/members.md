# Module Membres

## Vue d'ensemble

Le module Membres gère l'annuaire complet du club, les inscriptions annuelles et les comités.

## Catégories de membres

| Catégorie | Description |
|-----------|-------------|
| Membre actif | Pilote pratiquant, inscrit à l'année |
| Membre temporaire | Inscription courte période |
| Membre non volant | Participe au club sans voler |
| Pilote externe | Pilote d'un autre club |
| Bénévole | Contribution au club sans vol |
| Organisation externe | Club ou association partenaire |
| Client/Fournisseur | Relation commerciale |

## Drapeaux de rôle

Un membre peut cumuler plusieurs drapeaux : **Instructeur**, **Employé**, **Dirigeant**, **Membre du bureau**.

Règles métier :
- Un membre peut être à la fois instructeur et dirigeant.
- Un employé ne peut pas être simultanément dirigeant ou membre du bureau.

## Identifiant membre

Chaque membre reçoit un identifiant métier unique :
- `ME<ANNÉE>-<NNNN>` pour les membres club (ex. : `ME2026-0042`)
- `EXT-<NNNN>` pour les pilotes externes et organisations
- `FO-<NNNN>` pour les clients/fournisseurs

Cet identifiant sert également d'identité dans le grand livre comptable.

## Inscription annuelle

1. Ouvrir la fiche membre → onglet **Inscriptions**.
2. Cliquer **Nouvelle inscription**.
3. Sélectionner la catégorie et la période.
4. L'inscription génère automatiquement les écritures comptables correspondantes.

> Si l'inscription est réalisée à partir du 1er octobre, elle couvre également l'année suivante complète.

## Fiche membre

La fiche membre regroupe :
- Informations d'identité et de contact
- Statut d'inscription courant
- Carnet de vol (résumé)
- Solde de compte
- Dépenses et frais bénévolat (déduction fiscale)
- Documents associés

## Comités

Les comités regroupent des membres autour de missions spécifiques (sécurité, technique, événements…). Chaque comité dispose d'un responsable, d'une liste de membres et d'un budget.
