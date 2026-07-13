# Module Carburant — Plan de développement

## 1. Objectif

Permettre aux membres de déclarer un plein d'essence (avion ou TMG) sans authentification, via un QR code apposé sur chaque pompe/cuve, en alimentant un suivi de stock carburant. La génération des écritures comptables se fait a posteriori, au bilan, à partir des mouvements validés.

## 2. Modèle de données

```
Pompe
- id (uuid)
- nom                  # ex: "Cuve 100LL", "Cuve MOGAS"
- type_carburant        # enum: 100LL / MOGAS / ...
- token                 # chaîne opaque, unique, utilisée dans l'URL du QR
- actif                 # bool
- capacite_cuve_L        # pour bornage/alerte de cohérence

MouvementCarburant
- uuid
- pompe_id (FK Pompe)
- avion_immat            # FK vers table Avions existante
- quantite_L
- index_compteur          # optionnel, pour recoupement
- membre_declarant         # texte libre / autocomplete, déclaratif seulement
- date_saisie              # posée côté serveur
- statut                    # brouillon | valide | rejete
- ip_source, user_agent      # traçabilité
- commentaire_validation       # rempli par le responsable carburant si rejet/correction

StockCarburant (vue calculée)
- cumul des MouvementCarburant statut=valide, groupé par pompe/type_carburant
- même logique "balance-as-view" que le module comptable existant

GrilleTarifCarburant (historisée, comme les grilles de prix existantes)
- type_carburant, prix_L, date_debut, date_fin
```

Principe : `MouvementCarburant` est un journal de stock indépendant de la comptabilité, immuable (pas d'UPDATE, uniquement ajout de lignes de correction si besoin).

## 3. Backend — endpoints à prévoir

- `GET /plein/{token}` → sert la page formulaire (identifie la pompe via le token, 404 si token invalide/inactif)
- `POST /plein/{token}` → crée un `MouvementCarburant` en statut `brouillon`
  - Validation : quantité > 0 et cohérente avec la capacité de l'avion/cuve (flag si aberrant, pas de blocage dur)
  - Rate limiting par IP (ex: 1 soumission / pompe / 10 min)
- `GET /admin/carburant/mouvements?statut=brouillon` → file d'attente de validation
- `POST /admin/carburant/mouvements/{uuid}/valider` / `/rejeter` → workflow de validation par le responsable carburant
- `GET /admin/carburant/stock` → vue de stock courant par cuve
- `POST /admin/carburant/generer-ecritures?exercice=...` → job de fin de période qui parcourt les mouvements validés non encore comptabilisés, applique la grille tarifaire à la date du plein, et génère les écritures dans un nouveau journal dédié (ex: `CAR`), sur le même modèle que VT/REM

## 4. QR code

- Génération backend avec la lib `qrcode` (`ERROR_CORRECT_H` pour résister à l'usure sur le terrain)
- Export SVG pour impression grand format sans perte
- Un endpoint admin `GET /admin/carburant/pompes/{id}/qrcode` régénère l'image à partir du token courant
- Prévoir une action "régénérer le token" (rotation) si un QR est compromis ou détérioré, avec réimpression

## 5. Frontend

- Page publique `/plein/{token}` : mobile-first, pas de layout admin, formulaire minimal (avion, quantité, index compteur, déclarant en autocomplete)
- Écran admin "File de validation carburant" : liste des brouillons, actions valider/rejeter/corriger
- Écran admin "Stock carburant" : niveau cumulé par cuve, historique des mouvements
- Écran admin "Pompes" : CRUD des pompes + génération/téléchargement du QR

## 6. Sécurité / anti-abus

- Token opaque par pompe (non deviné), rotation possible
- Rate limiting par IP
- Logs IP + user-agent + horodatage sur chaque soumission
- Statut brouillon par défaut → aucune saisie n'impacte le stock officiel sans validation humaine
- Flag automatique (pas de blocage) sur quantités hors bornes

## 7. Ordre de mise en œuvre suggéré

1. Modèle de données (`Pompe`, `MouvementCarburant`) + migration
2. Endpoint public de soumission + formulaire mobile
3. Génération QR + écran admin "Pompes"
4. File de validation + vue de stock
5. Grille tarifaire carburant (historisée)
6. Job de génération des écritures au bilan (journal `CAR`)
