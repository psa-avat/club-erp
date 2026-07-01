
# PRD — Module Club · Gestion d'un Club de Vol à Voile

**Version :** 0.1 — Draft initial
**Date :** Avril 2026
**Statut :** En cours de rédaction

---

## 1. Contexte & Objectifs

### 1.1 Contexte

Un club de vol à voile gère une flotte de planeurs et de remorqueurs, une base de membres aux profils variés (pilotes brevetés, élèves, instructeurs, mécaniciens), ainsi qu'une comptabilité spécifique mêlant facturation à l'acte (vols), abonnements, charges fixes par machine et obligations réglementaires aéronautiques.

### 1.2 Objectifs du module Club

- Centraliser la gestion administrative et financière du club en un seul outil.
- Automatiser la facturation des vols sur les comptes membres.
- Offrir une visibilité temps réel sur la trésorerie, les coûts machine et l'état des membres.
- Fournir un portail membre en libre-service pour réduire la charge administrative.
- Garantir la traçabilité comptable nécessaire aux obligations légales (association loi 1901 ou structure commerciale).

### 1.3 Périmètre

Ce PRD couvre exclusivement le **module Club**. Les modules métier vol (carnet de vol, compte-rendu d'atterrissage, instruction) sont traités dans un PRD séparé mais alimentent ce module via des événements.

---

## 2. Utilisateurs & Rôles

| Rôle | Description | Accès principaux |
|---|---|---|
| **Administrateur club** | Trésorier / président | Toutes fonctions |
| **Comptable** | Externe ou interne | Comptabilité, rapports, exports |
| **Instructeur** | Pilote qualifié FI(S) | Planning, membres, vols |
| **Membre** | Pilote / élève | Portail membre, planning |
| **Mécanicien** | Responsable flotte | Machines, dépenses maintenance |
| **Visiteur** | Non membre | Portail public limité |

---

## 3. Domaines Fonctionnels

---

### 3.1 Gestion des Membres

#### Objectif
Maintenir le référentiel complet des membres, leurs qualifications, leurs cotisations et l'historique de leur activité au sein du club.

#### Données membres
- Identité : nom, prénom, date de naissance, photo
- Coordonnées : adresse, email, téléphone, contact urgence
- Numéro de membre (auto-incrémenté, paramétrable par préfixe annuel)
- Statut : `Actif` / `Inactif` / `Suspendu` / `Honoraire` / `Stagiaire`
- Catégorie : Pilote breveté, Élève en formation, Instructeur, Mécanicien, Membre non volant
- Qualifications et licences : numéro de licence FFVV, date d'expiration, niveau (BPP, SPL, FI(S), etc.)
- Visite médicale : classe, date d'obtention, date d'expiration — alerte automatique à J-60
- Documents attachés : scan licence, certificat médical, assurance personnelle
- Compte financier membre (solde courant, historique des transactions)

#### Règles métier
- Un membre ne peut voler si son solde est négatif au-delà d'un seuil paramétrable (ex. : -50 €).
- Un membre ne peut voler si sa visite médicale est expirée → blocage automatique + notification.
- Un membre ne peut voler si sa licence est expirée.
- La cotisation annuelle génère automatiquement une facture à la date de renouvellement.
- Un membre peut avoir plusieurs catégories simultanées (ex. : Instructeur + Pilote breveté).

#### User stories
- En tant qu'administrateur, je veux créer un dossier membre complet avec upload de documents, afin d'avoir un référentiel centralisé.
- En tant qu'administrateur, je veux recevoir une alerte 60 jours avant l'expiration de la visite médicale d'un membre, afin d'anticiper les renouvellements.
- En tant que membre, je veux consulter mon profil, mes qualifications et mon historique de vols via le portail, afin d'être autonome.

---

### 3.2 Gestion des Machines (Flotte)

#### Objectif
Référencer la flotte de planeurs et de remorqueurs, suivre leur état, leur utilisation et leurs coûts associés.

#### Données machines
- Immatriculation (ex. : F-CXYZ), type, constructeur, modèle, année
- Catégorie : Planeur monoplace / biplace / biplace double commande / Remorqueur
- Motorisation : planeur pur / motoplaneur / TMG
- Propriété : club / copropriété (avec liste des copropriétaires et % de détention) / location
- Tarif d'utilisation associé (lien vers module Tarifs)
- Compteur de référence : heures moteur, heures totales, nombre d'atterrissages
- Statut opérationnel : `En ligne` / `En maintenance` / `Immobilisé` / `Retraité`
- Potentiel restant : heures avant prochaine visite périodique (100h, 500h, etc.)
- Documents : carte de navigabilité, manuel de vol, assurance, CEN

#### Règles métier
- Une machine `Immobilisée` ne peut être sélectionnée dans le planning.
- Chaque vol enregistré incrémente automatiquement les compteurs de la machine.
- Alerte automatique quand le potentiel restant passe sous un seuil paramétrable (ex. : 10h).
- Le retrait d'une machine (statut `Retraité`) déclenche l'arrêt de l'amortissement.

#### User stories
- En tant que mécanicien, je veux visualiser en temps réel le potentiel restant de chaque machine, afin de planifier les visites d'entretien.
- En tant qu'administrateur, je veux être alerté quand une machine atteint son seuil de potentiel, afin de l'immobiliser avant la limite réglementaire.

---

### 3.3 Gestion des Tarifs

#### Objectif
Définir et maintenir les grilles tarifaires appliquées à la facturation des vols et des services.

#### Structure des tarifs
- **Tarif vol** : par heure de vol (décimale), par tranche d'heure, tarif fixe par décollage
- **Tarif remorquage** : par hauteur de largage (ex. : 300m, 600m, 1000m) ou par heure moteur remorqueur
- **Cotisation** : annuelle, semestrielle, par catégorie de membre
- **Tarif instruction** : supplément instructeur par heure
- **Tarif stage** : forfait stage (brevet, remise à niveau, etc.)
- **Autre** : location salle, baptêmes, etc.

#### Règles métier
- Un tarif a une date de début et une date de fin de validité.
- Plusieurs tarifs peuvent coexister (ex. : tarif membre standard vs tarif membre bienfaiteur).
- Un tarif est lié à une ou plusieurs machines (ex. : le Ka-8 n'a pas le même tarif que l'ASK-21).
- La modification d'un tarif n'affecte pas les vols déjà facturés.
- Les tarifs peuvent être définis HT ou TTC (paramètre de TVA par type de prestation).

---

### 3.4 Facturation des Vols sur Comptes Membres

#### Objectif
Générer automatiquement les lignes de facturation à partir des vols enregistrés et les imputer sur le compte du membre pilote ou d'un tiers désigné.

#### Flux de facturation
1. Un vol est enregistré dans le module Vol (durée, machine, pilote, passager, type de vol).
2. Le module Club récupère l'événement vol via API/événement interne.
3. Le moteur de tarification calcule le montant selon le tarif applicable à la date du vol et à la machine.
4. Une ligne de débit est inscrite sur le compte du membre désigné comme payeur (pilote commandant de bord par défaut, ou tiers renseigné).
5. La ligne est associée à une pièce justificative (bon de vol numéroté).
6. Le membre peut consulter les lignes en attente de validation et signaler une anomalie.

#### Imputation sur compte de tiers
- Un vol peut être imputé sur le compte d'un autre membre que le pilote (ex. : baptême payé par un invité qui a un compte temporaire, partage de frais en copropriété).
- Un membre peut déléguer la saisie de l'imputation à l'administrateur.
- Un vol peut être partiellement imputé sur plusieurs comptes (ex. : 50/50 entre deux pilotes en copropriété).

#### Règles métier
- Tout vol doit être rattaché à un compte avant clôture de journée.
- La facturation est générée en temps différé (batch quotidien ou à la demande).
- Un vol annulé avant décollage ne génère pas de facturation.
- Les vols d'instruction peuvent bénéficier d'un tarif réduit automatique si l'instructeur est à bord.

---

### 3.5 Comptabilité

#### Objectif
Tenir une comptabilité de trésorerie ou d'engagement conforme aux obligations d'une association (plan comptable associatif) ou d'une structure commerciale (PCG 2025).

#### Plan comptable
- Paramétrable : association loi 1901 (plan associatif) ou entreprise (PCG)
- Comptes de tiers membres (classe 4) liés à chaque fiche membre
- Comptes de charges par machine (classe 6)
- Comptes d'amortissement (classe 2/8)
- Journaux : Achats, Ventes, Banque, Caisse, OD (Opérations Diverses), Paie

#### Saisie & import
- Saisie manuelle d'écritures
- Import de relevés bancaires (OFX, CSV banque) pour lettrage semi-automatique
- Import de factures fournisseurs (PDF via OCR — optionnel v2)
- Génération automatique des écritures depuis la facturation vols

#### Lettrage & rapprochement bancaire
- Rapprochement automatique : matching par montant + date (tolérance ±3 jours)
- Rapprochement manuel : sélection de lignes à pointer
- État de rapprochement : solde théorique vs solde bancaire, écarts identifiés
- Lettrage des comptes de tiers : chaque débit membre est lettré à son règlement

#### Règles métier
- Chaque écriture doit être équilibrée (débit = crédit).
- Un exercice clôturé ne peut être modifié (verrouillage par date).
- La réouverture d'un exercice nécessite le rôle Administrateur + confirmation explicite.
- Les à-nouveaux sont calculés automatiquement à l'ouverture du nouvel exercice.

---

### 3.6 Immobilisations & Amortissements

#### Objectif
Gérer le cycle de vie comptable des actifs du club (planeurs, remorqueurs, véhicules, matériels) et calculer automatiquement les amortissements.

#### Données immobilisation
- Désignation, numéro d'inventaire
- Lien avec fiche machine (si applicable)
- Date d'acquisition, date de mise en service
- Valeur brute d'acquisition (HT)
- Mode d'amortissement : linéaire / dégressif
- Durée d'amortissement (en années, paramétrable par catégorie)
- Valeur résiduelle
- Fournisseur, numéro de facture d'achat
- Compte comptable d'immobilisation et compte d'amortissement associés

#### Calculs
- Dotation annuelle = valeur brute / durée (linéaire)
- Génération automatique des écritures de dotation aux amortissements (OD en fin de période)
- Tableau d'amortissement complet exportable (PDF / Excel)
- Valeur nette comptable (VNC) en temps réel

#### Règles métier
- La mise au rebut d'une immobilisation génère une écriture de sortie d'actif.
- Une cession génère un calcul de plus ou moins-value.
- Les subventions d'investissement reçues sont amorties sur la même durée que le bien.

---

### 3.7 Dépenses par Machine (Maintenance & Assurances)

#### Objectif
Suivre toutes les dépenses opérationnelles rattachées à chaque machine pour calculer un coût de revient réel par heure de vol.

#### Catégories de dépenses
- **Maintenance** : pièces, main d'œuvre atelier, révision périodique, visite 5 ans, peinture
- **Assurance** : prime annuelle, garanties souscrites
- **Carburant** (remorqueurs) : consommation, coût au litre
- **Certificat de navigabilité** : redevance DGAC / frais d'expertise
- **Hangare / stockage** : quote-part si affectation individuelle
- **Divers** : frais de déplacement pour convoyage, réparation après incident

#### Saisie
- Dépense saisie manuellement ou importée depuis comptabilité (lien compte de charge ↔ machine)
- Ventilation possible d'une dépense sur plusieurs machines (ex. : assurance flotte à répartir au prorata de la valeur)
- Rattachement à un ordre de travail (OT) pour la maintenance

#### Indicateurs calculés
- Coût total par machine par période
- Coût par heure de vol (dépenses / heures volées sur la période)
- Comparaison vs tarif facturé → marge ou déficit par machine

---

### 3.8 Salaires

#### Objectif
Gérer les salariés du club (instructeurs salariés, remorqueur, secrétaire) et intégrer les charges salariales en comptabilité.

#### Fonctionnalités
- Fiche salarié : identité, contrat (CDI/CDD/saisonnier), coefficient, salaire brut
- Import du bulletin de paie (PDF ou données structurées depuis logiciel de paie externe)
- Saisie manuelle des éléments de salaire : brut, charges patronales, charges salariales, net à payer
- Génération de l'écriture comptable de paie (journaux Paie + Banque)
- Suivi des charges sociales à payer par organisme (URSSAF, caisse retraite, prévoyance)
- Export DSN (optionnel v2 — via connecteur logiciel de paie)

#### Règles métier
- Le module salaires n'est pas un logiciel de paie complet : il centralise et comptabilise, sans calculer les bulletins.
- Chaque période de paie génère une écriture globale équilibrée.
- Les charges patronales sont ventilées par compte (URSSAF, retraite, prévoyance) pour le reporting.

---

### 3.9 Planning

#### Objectif
Permettre la réservation des machines et la gestion du planning d'instruction et d'activité club.

#### Fonctionnalités
- Vue calendrier hebdomadaire et mensuelle par machine
- Réservation d'un planeur par un membre (créneau, type de vol prévu, passager éventuel)
- Gestion des disponibilités instructeurs
- Planning d'instruction : affectation élève ↔ instructeur ↔ machine ↔ créneau
- Blocage automatique des machines immobilisées ou en maintenance
- Alerte de conflit de réservation
- Validation / refus de réservation par l'administrateur (workflow optionnel)
- Intégration avec le module Vol : à la fin du vol, la réservation est automatiquement soldée et le vol enregistré

#### Règles métier
- Un membre ne peut réserver qu'une machine à la fois sur un créneau donné.
- Une réservation non soldée 2h après la fin du créneau génère une alerte administrateur.
- Les créneaux de remorquage sont liés aux créneaux du remorqueur et de son pilote.

---

### 3.10 Rapports

#### Objectif
Fournir les états de synthèse nécessaires à la gestion du club, aux assemblées générales et aux obligations légales.

#### Rapports financiers
- Bilan comptable (actif / passif)
- Compte de résultat (produits / charges)
- Balance des comptes
- Grand livre
- Journal des ventes / achats / banque
- État des comptes membres (soldes, mouvements)
- Budget prévisionnel vs réalisé

#### Rapports opérationnels
- Activité vols par période (heures, cycles, machines, membres)
- Coût de revient par machine
- Tableau de bord instructeurs (heures d'instruction dispensées)
- Suivi des adhésions (entrées / sorties membres, taux de renouvellement)
- Tableau d'amortissement de la flotte

#### Rapports réglementaires
- Récapitulatif activité aéronautique (pour déclaration FFVV / DSAC)
- État des qualifications membres (expirations à venir)

#### Formats d'export
- PDF (mise en page soignée, logo club)
- Excel / CSV (pour retraitement)
- JSON (pour intégration externe)

---

### 3.11 Rapprochements Bancaires

*(Détaillé dans §3.5 — section dédiée pour insistance sur le flux)*

#### Flux complet
1. Import du relevé bancaire (OFX, CSV, ou saisie manuelle).
2. Matching automatique avec les écritures comptables.
3. Interface de rapprochement manuel pour les lignes non matchées.
4. Validation du rapprochement → verrouillage des lignes pointées.
5. Édition de l'état de rapprochement avec écarts résiduels expliqués.

#### Règles métier
- Un rapprochement doit être effectué au moins une fois par mois.
- Les écarts non justifiés bloquent la clôture mensuelle (avertissement, non bloquant en mode assoupli).

---

### 3.12 Portail Membre

#### Objectif
Offrir aux membres un accès en ligne sécurisé à leurs données personnelles et financières, et leur permettre d'effectuer certaines actions en autonomie.

#### Fonctionnalités membre
- Consultation du profil (données personnelles, qualifications, documents)
- Consultation du compte financier (solde, historique des transactions, factures)
- Paiement en ligne d'un rechargement de compte (Stripe ou équivalent)
- Réservation de machine via planning en ligne
- Consultation du planning d'instruction
- Téléchargement des factures et reçus
- Mise à jour des coordonnées et documents (avec validation admin)
- Notifications : alertes solde bas, expiration médical/licence, confirmation réservation

#### Fonctionnalités publiques (non authentifié)
- Présentation du club, tarifs publics, contact
- Formulaire de demande d'adhésion (génère un dossier en attente côté admin)

#### Règles métier
- L'accès portail est activé/désactivé par l'administrateur pour chaque membre.
- Un membre suspendu ne peut pas effectuer de réservation mais peut consulter son compte.
- Les données financières ne sont visibles que par le membre lui-même et les administrateurs.

---

## 4. Exigences Techniques Transverses

### 4.1 Architecture
- Application web responsive (mobile-first pour le portail membre)
- API REST interne entre modules (événements vol → facturation, planning → vol)
- Authentification : SSO possible, JWT, rôles granulaires

### 4.2 Sécurité & RGPD
- Données membres : chiffrement au repos, accès journalisé
- Droit à l'oubli : archivage anonymisé à la radiation du membre
- Exports soumis à traçabilité

### 4.3 Intégrations
- Import bancaire : OFX, CSV générique, connecteurs banques françaises (optionnel v2)
- Logiciel de paie : import PDF bulletins / export données structurées
- FFVV : export activité au format demandé
- Paiement en ligne : Stripe (portail membre)

### 4.4 Performance
- Génération d'un rapport bilan en < 3 secondes pour un exercice complet
- Planning : temps de réponse < 500ms pour affichage mensuel

### 4.5 Disponibilité
- Disponibilité cible : 99,5% (hors maintenance planifiée)
- Sauvegarde quotidienne automatique avec rétention 90 jours

---

## 5. Priorisation (MoSCoW)

| Priorité | Domaine |
|---|---|
| **Must** | Membres, Machines, Tarifs, Facturation vols, Comptabilité de base, Rapprochement bancaire |
| **Must** | Portail membre (consultation compte + réservation) |
| **Should** | Immobilisations & amortissements, Dépenses par machine, Rapports financiers complets |
| **Could** | Salaires, Planning avancé, Paiement en ligne portail |
| **Won't (v1)** | DSN, OCR factures, connecteurs banques natifs |

---

## 6. Questions Ouvertes

| # | Question | Impact |
|---|---|---|
| 1 | Le club est-il assujetti à la TVA sur les vols ? | Paramétrage TVA facturation |
| 2 | Gestion de la copropriété d'aéronefs dans le périmètre v1 ? | Complexité facturation |
| 3 | Exercice comptable = année civile ou décalé ? | Clôture & à-nouveaux |
| 4 | Nombre de salariés (pour calibrer le module paie) ? | Scope module salaires |
| 5 | Le club dispose-t-il déjà d'un logiciel de paie ? | Intégration vs saisie manuelle |
| 6 | Quel niveau de droit à la réservation souhaitez-vous ? (libre / avec validation) | UX planning |

---

Ce PRD constitue la **version 0.1** — à enrichir avec vos retours, les sessions de discovery utilisateur et les contraintes techniques de l'équipe de développement. Voulez-vous approfondir un domaine en particulier, ou attaquer un module spécifique en user stories complètes ?