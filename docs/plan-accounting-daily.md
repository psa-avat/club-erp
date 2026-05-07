## Plan: Interfaces Comptables Quotidiennes

Concevoir une expérience comptable orientée opérations journalières (fournisseurs, facturation membres/vols, encaissements, remboursements, salaires) en s’appuyant sur les composants UI déjà en place, avec un système d’échéances/rappels in-app (sans auto-génération d’écritures), puis étendre vers une vision complète par phases.

**Steps**
1. Phase 0 — Cadre UX transverse (bloquant pour toutes les phases)
- Définir le modèle de navigation cible “Comptabilité quotidienne” avec 6 espaces: Tableau de bord, Ventes membres, Vols, Fournisseurs, Paiements & Rapprochement, Salaires & OD.
- Standardiser un langage d’état commun (Brouillon, À valider, Validé, Échu, Payé, Remboursé, Lettré, Archivé) et des actions globales (Créer, Dupliquer, Planifier rappel, Valider, Comptabiliser, Annuler via extourne).
- Définir les conventions de composants réutilisés (en-tête, filtres, tableaux, badges, barres d’actions sticky, dialogues de confirmation).
- Dépendance: aucune.

2. Phase 1 — Tableau de bord Opérations (priorité haute)
- Concevoir une page d’atterrissage orientée “travail du jour” avec widgets: tâches en attente, échéances J+7, factures fournisseurs échues, comptes membres débiteurs, brouillons non comptabilisés.
- Ajouter une “boîte de triage” avec files d’actions rapides par type d’opération.
- Prévoir une vue “Calendrier des échéances” en mode liste chronologique (pas de calendrier graphique obligatoire au MVP) avec tri par urgence.
- Dépendance: phase 0.

3. Phase 2 — Flux Fournisseurs (factures + paiements)
- Concevoir le parcours “Saisie facture fournisseur” (en-tête, lignes comptables, PJ, date d’échéance, centre analytique optionnel), avec prévisualisation de l’écriture et validations d’équilibre.
- Concevoir la liste AP (A payer): statuts, montant restant, retard en jours, priorisation visuelle.
- Concevoir l’action “Régler” depuis facture avec génération guidée de l’écriture de paiement et lien vers rapprochement.
- Dépendance: phases 0 et 1.

4. Phase 3 — Flux Ventes membres (services/produits)
- Concevoir le parcours de facturation membre manuelle/semi-automatique: sélection membre, article/tarif, remises applicables, aperçu écritures (411/706x), validation finale.
- Concevoir la vue “Compte membre” centrée recouvrement: solde, historique, échéances, statut de relance.
- Ajouter actions de recouvrement UX: marquer rappel effectué, planifier prochaine relance in-app, annoter promesse de paiement.
- Dépendance: phases 0 et 1.

5. Phase 4 — Flux Facturation des vols
- Concevoir une “file de contrôle vols à facturer” (lot quotidien): vols importés, règles tarifaires appliquées, exceptions à traiter.
- Concevoir l’écran de revue de lot avec comparaison “données de vol vs montant calculé”, puis comptabilisation en masse.
- Prévoir gestion des cas limites UX (vol annulé, correction durée, remorqueur séparé, forfait/pack).
- Dépendance: phases 0, 1 et 3.

6. Phase 5 — Flux Encaissements & Rapprochement
- Concevoir la saisie encaissement (manuel + import relevé) avec suggestion de matching membre/facture.
- Concevoir l’écran de rapprochement: lignes banque non rapprochées, score de confiance du matching, confirmation manuelle.
- Définir les règles de feedback UX pour écarts (montant partiel, trop-perçu, doublon) et création de tâches de suivi.
- Dépendance: phases 0, 1 et 3.

7. Phase 6 — Remboursements
- Concevoir un assistant de remboursement piloté par motif (avoir, trop-perçu, annulation) avec contrôle anti-erreur et piste d’audit.
- Imposer un parcours en 2 étapes UX: brouillon de remboursement puis validation finale avec extourne/écriture associée.
- Ajouter suivi du cycle (Demandé, Vérifié, Validé, Exécuté).
- Dépendance: phases 0, 1 et 5.

8. Phase 7 — Salaires & Charges
- Concevoir un écran “OD salaires” guidé par modèle mensuel (net, charges patronales/salariales, organismes), avec check-list de conformité.
- Prévoir rappel d’échéances sociales/fiscales in-app avec vues par organisme.
- Ajouter verrou UX pour prévenir la comptabilisation hors période fiscale ouverte.
- Dépendance: phases 0 et 1.

9. Phase 8 — Système d’échéances et rappels in-app (vision complète demandée)
- Introduire un moteur UX de “deadlines” commun aux modules ci-dessus: date d’échéance, criticité, propriétaire, statut de rappel.
- Ajouter centre de notifications in-app (Aujourd’hui, Cette semaine, En retard) avec actions rapides contextuelles.
- Ajouter configuration métier des règles de rappel (J-7, J-3, J+1) sans auto-création d’écriture.
- Dépendance: phases 1 à 7 (peut démarrer en parallèle dès phase 2 sur un périmètre fournisseur).

10. Phase 9 — Accessibilité, mobilité, et robustesse opérationnelle
- Vérifier lisibilité et densité d’information desktop/mobile pour les tableaux opérationnels.
- Ajouter raccourcis clavier pour actions fréquentes (valider, comptabiliser, rapprocher).
- Renforcer les états vides/erreurs/réseau et les confirmations d’actions irréversibles.
- Dépendance: transversal, en parallèle de toutes les phases.

11. Phase 10 — Tunnel de Correction & Extourne (Senior UX)
- Concevoir un parcours "One-click Reversal" depuis n'importe quelle écriture validée/postée.
- L'interface doit générer automatiquement l'écriture inverse, lier les deux par UUID, et forcer la saisie d'un "Motif d'extourne".
- Ajouter un indicateur visuel "Annulé par l'écriture #XXX" sur l'original.

12. Phase 11 — Sécurité & Verrouillage de Période
- Ajouter un "Soft Lock" mensuel : permettre au comptable de verrouiller le mois de Mai pour empêcher le staff de créer des brouillons sur une période en cours de clôture.
- Intégrer le sélecteur de Fiscal Year global dans le bandeau supérieur pour filtrer instantanément tout le dashboard "Opérations".

13. Phase 12 — Livraison incrémentale et gouvernance
- Livrer en vagues: Vague A (Dashboard + Fournisseurs + Encaissements), Vague B (Ventes membres + Vols), Vague C (Remboursements + Salaires + deadlines avancées).
- Prévoir tests utilisateurs courts par profil (trésorier, staff, membre) à chaque vague et ajustements UX.
- Dépendance: planification globale.

14. Phase 13 — Optimisation des Flux Opérationnels et Vues Détaillées
- **Clarifier le rôle du Tableau de Bord Opérations (`BanqueDashboardPage.tsx` / `daily_accounting_club_erp_integrated.html`)** : En faire le hub principal pour les tâches comptables quotidiennes et les actions en masse, notamment la revue et la comptabilisation groupée des brouillons.
- **Affiner l'écran des Écritures de Journal (`JournalEntriesScreen.tsx`)** : Le transformer en un outil d'audit et de recherche détaillé. Les actions en masse (comme la comptabilisation groupée) y seront moins proéminentes, voire déplacées vers le tableau de bord, afin de se concentrer sur la recherche avancée, la consultation individuelle et la gestion fine des écritures (suppression de brouillons, visualisation des détails).
- **Harmoniser les points d'entrée pour la création d'écritures** : Le tableau de bord offrira des actions rapides contextuelles (ex: "Nouvelle facture fournisseur", "Facturer membre"), tandis que l'écran des écritures de journal conservera un bouton "Nouvelle écriture" pour un accès direct et générique.
- Dépendance: Phases 1 et 12.

**Relevant files**
- /home/erpadmin/club-erp/docs/SPEC_ACCOUNTING.md — règles métier comptables, états et contraintes de cycle.
- /home/erpadmin/club-erp/docs/PLAN_ACCOUNTING_UXUI_IMPLEMENTATION.md — base d’implémentation UX déjà cadrée pour la comptabilité.
- /home/erpadmin/club-erp/docs/CHECKLIST_ACCOUNTING_IMPLEMENTATION.md — séquencement et exigences de complétude.
- /home/erpadmin/club-erp/docs/ux-audit-phase1.md — retours UX à intégrer dans les nouveaux parcours.
- /home/erpadmin/club-erp/frontend/src/modules/banque/components/JournalEntriesScreen.tsx — pattern liste/filtres pour opérations.
- /home/erpadmin/club-erp/frontend/src/modules/banque/components/JournalEntryWorkspaceScreen.tsx — pattern écran de saisie/workspace.
- /home/erpadmin/club-erp/frontend/src/modules/banque/components/journalShared.tsx — éditeur de lignes comptables, badges d’état, helpers Decimal.
- /home/erpadmin/club-erp/frontend/src/components/ui/data-table.tsx — tableau standard triable.
- /home/erpadmin/club-erp/frontend/src/components/ui/filter-bar.tsx — barre de filtres active.
- /home/erpadmin/club-erp/frontend/src/components/ui/sticky-action-bar.tsx — actions primaires persistantes.
- /home/erpadmin/club-erp/backend/api/routes/accounting.py — capacités backend réellement disponibles (entries, modèles, pricing, reporting).
- /home/erpadmin/club-erp/backend/services/members.py — facturation existante liée à l’inscription membre.

**Verification**
1. Vérification UX métier: faire valider chaque flux par scénarios réels (6 opérations quotidiennes) avec critères “temps de traitement”, “erreurs évitées”, “compréhension des statuts”.
2. Vérification fonctionnelle: s’assurer que chaque écran cible une capacité backend existante; marquer explicitement les écrans “UI-ready / backend-gap”.
3. Vérification cohérence: contrôler l’uniformité des statuts, badges, actions et messages d’erreur entre tous les flux.
4. Vérification précision: tester calculs monétaires et affichages montants via Decimal.js, y compris cas limites (arrondis, partiels, négatifs contrôlés).
5. Vérification échéances: simuler rappels J-7/J-3/J+1 et files “en retard” sur fournisseurs, membres, et obligations salaires.
6. Vérification accessibilité/mobile: valider navigation clavier, focus visible, contraste, et usage smartphone sur écrans denses.

**Decisions**
- Décision utilisateur: viser une vision complète et non un MVP strict.
- Décision utilisateur: UX priorisée pour tous les profils (trésorier, staff, membres) avec parcours adaptés.
- Décision utilisateur: récurrence via rappels/échéances in-app seulement au départ (pas d’auto-génération d’écritures).
- Inclus: design fonctionnel des 6 opérations, deadlines/rappels, lotissement de livraison.
- Exclu (à ce stade): notifications email/ICS, moteur de planification automatique d’écritures.

**Further Considerations**
1. Priorisation d’implémentation recommandée: commencer par fournisseurs + encaissements, car ce sont les zones à plus fort risque de retards et erreurs de trésorerie.
2. Pour la facturation des vols, prévoir tôt un écran “exceptions” dédié afin d’éviter la complexité cachée dans le flux nominal.
3. Si la charge projet est contrainte, réduire la Vague A au strict trio: triage dashboard, facture fournisseur, rapprochement simple.