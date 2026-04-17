export const en = {
  common: {
    app: {
      name: 'Club ERP',
    },
    auth: {
      login: 'Sign in',
      logout: 'Sign out',
      logoutLoading: 'Signing out...',
      closeLoginModal: 'Close login window',
      secureLogin: 'Secure sign-in to your club space.',
      enterPin: 'Enter the PIN code received by email to complete sign-in.',
      pinLabel: 'PIN code',
      verifyPin: 'Verify code',
      loginInProgress: 'Signing in...',
      email: 'Email',
      password: 'Password',
      invalidCredentials: 'Invalid credentials. Check your email and password.',
      inactiveAccount: 'This account is inactive. Contact an administrator.',
      invalidEmail: 'Invalid email format.',
      loginFailed: 'Unable to sign in. Try again in a moment.',
      sessionVerification: 'Verifying session...',
      activeSession: 'Active session',
    },
    nav: {
      dashboard: 'Dashboard',
      club: 'Club',
      planning: 'Planning',
      banque: 'Accounting',
      admin: 'Admin',
      modules: 'Modules',
      openMenu: 'Open menu',
      closeMenu: 'Close',
    },
  },
  dashboard: {
    home: {
      title: 'Dashboard',
      description: 'Club overview with key indicators, notifications and cross-module search.',
    },
  },
  club: {
    home: {
      title: 'Club Module',
      description: 'Member directory, pilot profiles and fleet management will be available here.',
    },
  },
  planning: {
    home: {
      title: 'Planning Module',
      description: 'Digital flight board, daily assignments and activity tracking will be managed here.',
    },
  },
  banque: {
    home: {
      title: 'Accounting Module',
      description: 'Member ledgers, flight billing and bank reconciliation will be consolidated here.',
    },
  },
  admin: {
    home: {
      title: 'Admin Module',
      description: 'User management, roles, audit and application configuration will be centralized here.',
    },
  },
} as const
