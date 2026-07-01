# Module Vols d'Initiation (VI)

## Présentation

Les vols d'initiation (VI) permettent à des non-membres de découvrir le vol à voile via l'achat d'un bon. Les bons sont vendus sur **HelloAsso** ou directement au club.

Le module est accessible depuis le menu **VI & HelloAsso**, organisé en six onglets :

| Onglet | Rôle |
|--------|------|
| Bons VI | Liste complète des bons, saisie, édition, annulation, conversion |
| Planning | Calendrier 4 semaines — glisser-déposer pour planifier les dates de vol |
| Vols | Réconciliation : associe les vols d'initiation validés à leurs bons VI |
| HelloAsso | Import des achats de bons depuis la plateforme HelloAsso |
| Sync Planche | Pousse les bons planifiés et génériques vers le logiciel Planche |
| Types VI | Catalogue des types de bons (configuration, comptes comptables) |

## Types de VI

Chaque type de VI définit :
- Un intitulé et une description
- Une durée estimée
- Un tarif associé
- Les ressources nécessaires (instructeur, type d'appareil)
- Les comptes comptables : compte d'avances clients (419xxx), compte de produits (706x), quote-part assurance fédérale optionnelle (401-FFVP), et un compte bancaire

## Cycle de vie d'un bon

```
Chargé → Planifié → Réalisé → Converti
Chargé → Annulé
       → Expiré
```

| Statut | Signification | Actions disponibles |
|--------|----------------|----------------------|
| Chargé | Bon créé, en attente de planification | Modifier · Planifier · Annuler · Voir écritures |
| Planifié | Date de vol assignée, prêt à être poussé vers Planche | Modifier · Annuler · Voir écritures |
| Réalisé | Vol effectué, écriture de réalisation générée | Convertir en membre · Voir écritures |
| Expiré | Date de validité dépassée sans réalisation | Voir écritures uniquement |
| Annulé | Bon annulé (avec ou sans remboursement) | Voir écritures uniquement |
| Converti | Acheteur converti en membre du club | Voir écritures uniquement |

## Créer un bon VI

### Saisie manuelle

Pour un bon vendu directement au club (chèque, espèces, virement, etc.) :

1. Ouvrir l'onglet **Bons VI** et cliquer sur **+ Nouveau bon**.
2. Renseigner les champs obligatoires :
   - **Code** — identifiant unique du bon (ex. `VI-2026-042`)
   - **Type VI** — nature du bon (détermine les comptes comptables et la tarification)
   - **Montant TTC** — montant encaissé

   Champs facultatifs : description, date de validité, code partenaire, notes.
3. **Option « Enregistrer l'encaissement »** : si vous cochez cette case (recommandé), le formulaire affiche des champs supplémentaires pour créer l'écriture bancaire au moment de la sauvegarde (voir *Encaissement* ci-dessous).
4. Cliquer sur **Enregistrer**. Le bon apparaît en statut **Chargé**.

### Import depuis HelloAsso

Les bons vendus via la plateforme HelloAsso sont importés automatiquement via la file de traitement staging.

1. Aller dans l'onglet **HelloAsso**.
2. Cliquer sur **Récupérer les achats HelloAsso**. L'ERP interroge l'API HelloAsso et charge les nouvelles transactions dans la file d'attente (staging).
3. La liste affiche les achats en attente avec leur nom, email, montant et date. Sélectionner les lignes à convertir en bons.
4. Choisir le **type VI** à appliquer, puis cliquer sur **Convertir en bons VI**. L'ERP crée automatiquement un bon **Chargé** pour chaque ligne sélectionnée. Le code du bon est généré à partir du numéro de commande HelloAsso.

> Les doublons sont automatiquement ignorés : si une transaction HelloAsso a déjà été importée, elle n'est pas recréée.

## Encaissement — Étape 1 comptable

L'encaissement correspond à la réception du paiement du bon VI. Il génère une écriture dans le **journal VI** :

**Journal VI · Écriture d'encaissement `VI-ENC-{code}`**

| Sens | Compte | Libellé | Montant | Tiers |
|------|--------|---------|---------|-------|
| D | 512xxx / 530xxx | Banque ou Caisse | Montant TTC | — |
| C | 419xxx | Avances clients VI | Montant TTC | Acheteur |

Cette écriture peut être créée :
- **Lors de la création manuelle du bon** — en cochant « Enregistrer l'encaissement » dans le formulaire.
- **Ultérieurement** — en ouvrant le bon (icône crayon) puis en utilisant la section *Encaissement* en bas du formulaire.

> Pour les bons HelloAsso, l'encaissement a déjà eu lieu sur la plateforme. L'écriture reste à saisir manuellement si vous souhaitez la faire apparaître dans votre comptabilité ERP.

> **Attention** — Un seul encaissement peut être enregistré par bon. Si vous avez commis une erreur, il faut annuler l'écriture depuis le module Finance avant d'en créer une nouvelle.

## Planifier un bon

La planification consiste à **assigner une date de vol** au bon. C'est une étape indispensable avant l'envoi vers Planche. Aller dans l'onglet **Planning**.

1. Les bons non planifiés apparaissent dans la zone **« Non planifiés »** en bas de l'écran.
2. Faites glisser un bon vers le jour souhaité dans le calendrier. La date de vol est enregistrée immédiatement et le statut passe à **Planifié**.
3. Pour **déplanifier** un bon : glissez-le depuis le calendrier vers la zone « Non planifiés », ou cliquez sur le **×** qui apparaît en survol sur la carte du bon. Le statut repasse à **Chargé**.
4. Utilisez les boutons **←** / **→** pour naviguer entre les périodes de 4 semaines. Le bouton **Aujourd'hui** revient à la semaine courante.

> Couleur des cartes : bleue = bon **Chargé**, ambre = bon **Planifié**.

## Synchronisation vers Planche

Une fois les bons planifiés (ou pour les bons génériques), ils peuvent être transmis à **Planche**, le logiciel de gestion des planches de vol du club.

1. Aller dans l'onglet **Sync Planche**. La liste affiche automatiquement tous les bons éligibles : **bons génériques** (sans acheteur nominatif) et **bons planifiés** (statut = Planifié). Ils sont tous pré-cochés.
2. Décochez les bons que vous ne souhaitez *pas* envoyer à cette session.
3. Option **« Écraser les données existantes »** : à cocher uniquement si vous souhaitez mettre à jour des bons déjà présents sur Planche (modification de date, par exemple).
4. Cliquer sur **Pousser vers Planche (N)**. Un résumé indique le nombre de bons envoyés et les éventuels échecs.

> **Attention** — La synchronisation nécessite que les paramètres de connexion à Planche soient configurés par l'administrateur (module Admin → Intégration Planche).

## Associer un bon à un vol

Après le vol d'initiation, il faut associer le bon VI au vol validé dans l'ERP. C'est cette association qui déclenche ensuite la réalisation comptable.

1. Aller dans l'onglet **Vols**. Par défaut, seuls les vols d'initiation **non encore associés** sont affichés.
2. Repérer le vol concerné (date, pilote, machine). Si la colonne *Bon VI (Planche)* affiche un code, c'est le code saisi dans Planche au moment du vol : cela peut vous aider à identifier le bon.
3. Cliquer sur l'icône **🔗** (chaîne) sur la ligne du vol. Une fenêtre s'ouvre.
4. Dans la fenêtre, recherchez et sélectionnez le bon VI correspondant parmi les bons actifs (Chargé ou Planifié). Si le bon a un code Planche, il sera pré-sélectionné automatiquement.
5. Cliquer sur **Associer**. Le vol est lié au bon ; sur la liste des vols, il affiche maintenant un badge **Lié**.

Pour afficher **tous** les vols (y compris déjà associés), cochez *« Afficher tous les vols d'initiation »* en haut à droite.

> Un vol ne peut être associé qu'à **un seul** bon VI. Un bon peut en revanche être associé à plusieurs vols si son type le permet (*max_flights* configuré dans le type VI).

## Réalisation comptable — Étape 2

Une fois le vol effectué et le bon associé au vol, on génère l'**écriture de réalisation**. Elle constate le chiffre d'affaires du vol d'initiation et solde le compte d'avances clients.

1. Dans l'onglet **Bons VI**, ouvrir la fiche du bon en cliquant sur l'icône 📖 (livre ouvert).
2. Dans la section *Réalisation*, renseigner la **date de réalisation** (date du vol) et l'**exercice fiscal**.
3. Cliquer sur **Générer l'écriture de réalisation**. Le statut du bon passe à **Réalisé**.

**Journal VI · Écriture de réalisation `VI-REAL-{code}`**

| Sens | Compte | Libellé | Montant | Tiers |
|------|--------|---------|---------|-------|
| D | 419xxx | Avances clients VI | Montant TTC | Acheteur |
| C | 706x | Prestations de vol (hors assurance) | TTC − assurance | — |
| C | 401-FFVP | Assurance fédérale (si configurée) | Quote-part assurance | Fédération |

> Si le type VI n'a pas de quote-part d'assurance configurée, la ligne assurance est omise et le crédit va intégralement en `706x`. L'écriture reste équilibrée.

## Écriture analytique — Étape 3

En complément de l'écriture de réalisation, l'ERP peut générer une **écriture analytique** de valorisation du vol (Étape 3). Elle est créée automatiquement lorsque l'association vol ↔ bon est enregistrée si les comptes analytiques sont configurés sur le type VI.

**Journal OD · Écriture analytique**

| Sens | Compte | Libellé | Montant |
|------|--------|---------|---------|
| D | 921xxx | Coût analytique du vol | Valorisation horaire × durée |
| C | 902xxx | Reflet analytique | Valorisation horaire × durée |

## Annulation d'un bon

Un bon en statut **Chargé** ou **Planifié** peut être annulé. Cliquer sur l'icône ✕ (cercle) dans la colonne d'actions.

### Sans remboursement

L'acheteur ne souhaite pas être remboursé (avoir, don, etc.).

1. Dans la boîte de dialogue d'annulation, choisir **« Annuler sans remboursement »**.
2. Confirmer. Le statut passe à **Annulé**. Aucune écriture comptable n'est créée à cette étape — le solde en `419xxx` reste ouvert.

> **Attention** — Si un encaissement avait été enregistré (Étape 1), le compte `419xxx` reste créditeur. Un transfert manuel en produit exceptionnel peut être nécessaire selon votre politique comptable.

### Avec remboursement

L'acheteur est remboursé par virement ou chèque.

1. Dans la boîte de dialogue d'annulation, choisir **« Annuler avec remboursement »**.
2. Renseigner : **exercice fiscal**, **compte bancaire** débité, **montant** (pré-rempli avec le montant TTC du bon), **libellé** (facultatif).
3. Cliquer sur **Rembourser et annuler**. L'écriture est créée en brouillon et le statut passe à **Annulé**.

**Journal VI · Écriture de remboursement `VI-REMB-{code}`**

| Sens | Compte | Libellé | Montant | Tiers |
|------|--------|---------|---------|-------|
| D | 419xxx | Avances clients VI — solde de l'avance | Montant TTC | Acheteur |
| C | 512xxx | Banque — remboursement | Montant TTC | — |

## Conversion en membre

Si l'initiant souhaite **adhérer au club**, le bon VI peut être converti en droits de membre. Cette opération est disponible uniquement pour les bons en statut **Réalisé**.

1. Dans l'onglet **Bons VI**, cliquer sur l'icône 👤+ (UserCheck) sur la ligne du bon réalisé.
2. Dans la boîte de dialogue, rechercher et sélectionner le **membre** nouvellement inscrit dans l'ERP.
3. Sélectionner l'**exercice fiscal**, puis cliquer sur **Convertir**.
4. L'ERP crée une écriture OD de reconversion et fait passer le bon en statut **Converti**. Les vols liés sont re-facturés au membre.

**Journal OD · Écriture de conversion en membre**

| Sens | Compte | Libellé | Montant | Tiers |
|------|--------|---------|---------|-------|
| D | 706x | Prestations VI — annulation produit | TTC − assurance | — |
| D | 401-FFVP | Assurance — annulation (si applicable) | Quote-part assurance | Fédération |
| C | 411xxx | Compte client membre — créance | Montant TTC | Nouveau membre |

> Après la conversion, les vols d'initiation liés au bon sont automatiquement re-facturés au nom du nouveau membre (le compte de charge passe de l'acheteur anonyme au compte membre `411xxx`).

## Récapitulatif du flux financier complet

Enchaînement chronologique des quatre étapes comptables pour un bon VI dont le vol est réalisé et l'acheteur adhère au club :

**1. Encaissement → 2. Réalisation → 3. Analytique → 4. Conversion membre**

| Étape | Débit | Crédit | Journal | Résultat |
|-------|-------|--------|---------|----------|
| 1 · Encaissement | 512 / 530 | 419 | VI | Trésorerie ↑ · Avance client ↑ |
| 2 · Réalisation | 419 | 706 + 401 | VI | CA reconnu · Avance soldée |
| 3 · Analytique | 921 | 902 | OD | Coût analytique valorisé |
| 4 · Conversion | 706 + 401 | 411 | OD | Créance membre établie |
| *Cas alternatif — Remboursement* | 419 | 512 | VI | Avance soldée · Trésorerie ↓ |

> Toutes les écritures générées par le module VI sont créées en état **Brouillon**. Elles doivent être validées (lettrées et pointées) dans le module Finance avant clôture de l'exercice.

## Questions fréquentes

**Je ne vois pas le bouton « Annuler » sur un bon planifié.**
Le bouton ✕ est disponible pour les statuts Chargé et Planifié. Si vous ne le voyez pas, vérifiez que le bon n'est pas déjà en statut Réalisé, Annulé ou Converti.

**Puis-je modifier un bon réalisé ?**
Non. Les bons en statut Réalisé, Annulé ou Converti ne peuvent plus être modifiés via le formulaire d'édition. Seule la conversion en membre reste disponible pour les bons Réalisés.

**La date de vol a changé — comment mettre à jour un bon déjà planifié ?**
Rendez-vous dans le calendrier Planning et faites glisser la carte du bon vers le nouveau jour, ou cliquez sur × pour déplanifier puis re-planifiez. Puis relancez une synchronisation Planche avec l'option « Écraser ».

**Un vol d'initiation n'apparaît pas dans l'onglet Vols.**
L'onglet Vols affiche uniquement les vols de type « Initiation » (type_of_flight = 2) récupérés depuis Planche. Si le vol ne s'affiche pas, effectuez d'abord une synchronisation Planche dans le module Vols (Récupérer depuis Planche).

**Le compte d'avances clients (419xxx) n'est pas configuré.**
Les comptes comptables sont paramétrés par type VI dans l'onglet Types VI. Un compte 419xxx (client_account), un compte de produits 706x (revenue_account) et un compte bancaire sont obligatoires pour générer les écritures.

**Que faire si l'écriture de réalisation a déjà été validée (lettrée) et que je veux la corriger ?**
Les écritures comptables validées (pointées) ne peuvent pas être supprimées depuis le module VI. Utilisez le module Finance pour créer une écriture de contre-passation, puis régularisez manuellement.

**Comment savoir quels bons HelloAsso ont déjà été convertis en bons VI ?**
Dans l'onglet HelloAsso, les lignes déjà converties affichent un statut « Promu ». Les lignes encore en attente restent en statut « Staged ».
