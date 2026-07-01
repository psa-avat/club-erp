# Module Aéronefs & Équipements

## Vue d'ensemble

Gère l'inventaire complet : planeurs, remorqueurs, treuils, équipements sol, consommables.

## Types d'aéronef

Chaque type définit :
- Une catégorie (Aéronef, Équipement de lancement, Support, Consommable, Service)
- La durée d'amortissement standard
- Le suivi comptable (immobilisation ou non)

## Fiche aéronef

| Champ | Description |
|-------|-------------|
| Immatriculation / Code | Identifiant unique (ex. : F-CGVX) |
| Type | Référence au type d'aéronef |
| Propriété | Club ou Privé (avec co-propriétaires) |
| Statut | Opérationnel / En maintenance / Hors service / Cédé / Vendu |
| Prix d'acquisition | Valeur d'entrée |
| Amortissement | Date de début, durée, valeur résiduelle |
| Compte comptable | Compte d'immobilisation associé |

## Propriété privée

Pour les planeurs privés, un ou plusieurs co-propriétaires membres sont enregistrés. La facturation des vols sur ces appareils génère un avertissement non bloquant si aucun tarif n'est configuré.

## Statuts d'un aéronef

```
Opérationnel → En maintenance → Opérationnel
                              → Hors service → Cédé / Vendu
```

## Synchronisation Planche

Les aéronefs actifs sont automatiquement poussés vers **Planche** pour être disponibles lors de la saisie des vols.
