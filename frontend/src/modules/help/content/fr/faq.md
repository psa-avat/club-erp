# Questions fréquentes

**Q : Un vol modifié sur Planche est-il automatiquement mis à jour dans l'ERP ?**
R : Non. Il faut déclencher manuellement un nouvel import depuis le menu Vols → Import Planche. Le vol est réimporté avec une révision, et si des écritures avaient déjà été créées, elles doivent être corrigées.

**Q : Que se passe-t-il si aucun tarif n'est configuré pour un vol ?**
R : La prévisualisation de facturation retourne une erreur bloquante. L'ERP ne peut pas appliquer la facturation tant qu'une version de tarif active et compatible n'existe pas pour la date du vol.

**Q : Peut-on acheter un pack après avoir déjà effectué des vols ?**
R : Oui. Un pack peut être acheté à tout moment dans l'exercice fiscal en cours. Le moteur de recalcul ré-applique automatiquement les remises sur tous les vols non postés de l'année.

**Q : Peut-on rouvrir un exercice fiscal clôturé ?**
R : Oui, un exercice peut être réouvert (état « Réouvert ») pour corrections. Les corrections sur des écritures postées passent toujours par contre-passation + nouvelle écriture.

**Q : Comment corriger une erreur dans une écriture comptable déjà postée ?**
R : Les écritures postées sont immuables. L'ERP génère automatiquement une contre-passation (écriture inverse) et une écriture de remplacement. Contacter le responsable comptable pour initier la correction.

**Q : Les soldes de packs non utilisés sont-ils reportés à l'année suivante ?**
R : Non. Les packs sont strictement liés à un exercice fiscal. Tout solde non consommé au 31 décembre est perdu.

**Q : Comment accéder au portail membre ?**
R : Le club communique une URL spécifique au portail. Les identifiants du portail sont distincts des identifiants ERP administratifs.

**Q : Qu'est-ce que l'identifiant `ME2026-0042` ?**
R : C'est l'identifiant métier unique du membre, généré automatiquement à la création. Il sert aussi de référence dans le grand livre comptable (compte 411).
