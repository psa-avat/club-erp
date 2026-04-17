export const fr = {
  common: {
    app: {
      name: 'Club ERP',
    },
    auth: {
      login: 'Se connecter',
      logout: 'Se deconnecter',
      logoutLoading: 'Deconnexion...',
      closeLoginModal: 'Fermer la fenetre de connexion',
      secureLogin: 'Connexion securisee a votre espace club.',
      enterPin: 'Entrez le code PIN recu par email pour terminer la connexion.',
      pinLabel: 'Code PIN',
      verifyPin: 'Verifier le code',
      loginInProgress: 'Connexion en cours...',
      email: 'Email',
      password: 'Mot de passe',
      invalidCredentials: 'Identifiants invalides. Verifiez votre email et votre mot de passe.',
      inactiveAccount: 'Ce compte est inactif. Contactez un administrateur.',
      invalidEmail: "Le format de l'email est invalide.",
      loginFailed: 'Connexion impossible. Reessayez dans un instant.',
      sessionVerification: 'Verification de session...',
      activeSession: 'Session active',
    },
    nav: {
      dashboard: 'Dashboard',
      club: 'Club',
      planning: 'Planning',
      banque: 'Banque',
      admin: 'Admin',
      modules: 'Modules',
      openMenu: 'Ouvrir le menu',
      closeMenu: 'Fermer',
    },
  },
  dashboard: {
    home: {
      title: 'Dashboard',
      description: "Vue d'ensemble du club avec indicateurs clefs, notifications et recherche transverse.",
    },
  },
  club: {
    home: {
      title: 'Module Club',
      description: 'Annuaire des membres, profils pilotes et flotte aeronefs seront exposes ici.',
    },
  },
  planning: {
    home: {
      title: 'Module Planning',
      description: 'Planche de vol numerique, affectations quotidiennes et suivi des activites seront geres ici.',
    },
  },
  banque: {
    home: {
      title: 'Module Banque',
      description: 'Comptes adherents, facturation des vols et reconciliation bancaire seront consolides ici.',
    },
  },
  admin: {
    home: {
      title: 'Module Admin',
      description: 'Gestion des utilisateurs, roles, audit et configuration applicative seront centralises ici.',
    },
  },
} as const
