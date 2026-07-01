# Module Tarifs & Prix

## Versions de tarifs

Les tarifs sont organisés en **versions** avec une période de validité (`date début` → `date fin`). Plusieurs versions peuvent coexister, mais une seule est active à tout moment pour un type d'aéronef donné.

**Périmètre d'une version :**
- **Global / cotisations** : tarifs non liés à un type d'appareil
- **Spécifique aéronef** : tarifs liés à un type d'appareil (planeur, remorqueur…)

**États d'une version :**
```
Brouillon → Active → Archivée
```

Une version verrouillée (`is_locked`) ne peut plus être modifiée.

## Lignes de tarif

Chaque version contient des lignes définissant :
- Le type de vol concerné (instruction, solo, remorqué…)
- L'unité de facturation (durée, nombre de lancements…)
- Le tarif unitaire
- Des paliers progressifs (ex. : réduction après N heures)

**Règle de palier :** le palier applicable est le plus haut palier dont le seuil est inférieur ou égal à la consommation du membre.

## Packs tarifaires

Un pack offre un crédit prépayé de vols à un tarif préférentiel. Caractéristiques :
- Lié à un exercice fiscal (pas de report possible)
- Applicable rétroactivement sur les vols de l'exercice
- Consommation en FIFO (premier pack acheté = premier utilisé)
