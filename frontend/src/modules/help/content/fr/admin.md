# Intégrations externes

## Planche

Planche est l'application de terrain qui gère les vols en temps réel. L'ERP est la **source de vérité** pour les membres, machines et bons VI. Planche est la **source de vérité** pour les vols validés.

**Flux de données :**
```
ERP → Planche : membres, aéronefs, bons VI actifs
Planche → ERP : vols validés (import)
```

**Configuration :** Admin → Paramètres → Planche (URL, token API).

## HelloAsso

HelloAsso est la plateforme de vente en ligne des bons VI.

1. Menu **Intégrations → HelloAsso**.
2. Configurer les clés API dans Admin → Paramètres.
3. Déclencher l'import pour récupérer les nouvelles commandes.

## GesAsso

GesAsso est le logiciel fédéral de gestion des licences pilotes.

Après validation des vols dans l'ERP, ils peuvent être envoyés à GesAsso pour mise à jour des carnets de vol fédéraux. Requiert la capacité `FEDERAL_SYNC`.

## OSRT

OSRT est le système fédéral de suivi de la navigabilité des aéronefs. Les heures de vol par machine lui sont transmises périodiquement.

# Administration système

## Utilisateurs, rôles et capacités

Menu : **Admin → Utilisateurs**

- Créer / modifier / désactiver des comptes utilisateurs
- Affecter des rôles prédéfinis
- Affiner les permissions avec des capacités individuelles
- Réinitialiser les mots de passe

## Paramètres système

Menu : **Admin → Paramètres**

| Section | Description |
|---------|--------------|
| Stockage | Configuration S3 / RustFS pour les pièces jointes |
| Planche | URL et token de l'API Planche |
| HelloAsso | Clés API HelloAsso |
| GesAsso | Paramètres de connexion GesAsso |
| Email | Serveur SMTP pour les notifications |
| OSRT | Paramètres OSRT |
| Click & Glide | Paramètres planning activités |

## Journal d'audit

Le journal d'audit trace toutes les actions sensibles (modifications de données, validations comptables, changements de configuration).
