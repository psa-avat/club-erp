export type ShellNavItem = {
  to: string
  labelKey: string
  requiredCapability?: string
  /** Optional sub-routes shown when this group is active in the sidebar */
  children?: Array<{ to: string; labelKey: string; requiredCapability?: string }>
}

/**
 * Navigation structure regroupant les 14 modules techniques en 9 espaces
 * orientés workflow. Chaque entrée peut être filtrée dynamiquement par
 * requiredCapability — la Sidebar.tsx ne montre que les entrées dont
 * le user.capabilities inclut la capability requise.
 *
 * Groupes :
 *   Daily Operations  → cockpit des vols, packs, planning, alertes
 *   Members 360       → annuaire, workspace, commissions, fiches
 *   Finance           → banque, journal, exercices, PCG, tarifs, rapports
 *   Assets (Flotte)   → équipements, types, tarifs machine
 *   Sales & Suppliers → ventes membres, factures fournisseurs
 *   Integrations      → Planche, HelloAsso, Gesasso, OSRT
 *   Reporting         → KPIs, budgets, rapports financiers
 *   Administration    → utilisateurs, paramètres, audit
 */
export const shellNavItems: ShellNavItem[] = [
  // ── Tableau de bord ───────────────────────────────────────────────────────
  { to: '/dashboard', labelKey: 'nav.dashboard' },

  // ── Daily Operations (Cockpit des vols) ───────────────────────────────────
  {
    to: '/flights',
    labelKey: 'nav.dailyOps',
    requiredCapability: 'EDIT_FLIGHTS',
    children: [
      { to: '/flights', labelKey: 'nav.flights', requiredCapability: 'EDIT_FLIGHTS' },
      { to: '/banque/packs', labelKey: 'nav.packs', requiredCapability: 'MANAGE_PRICES' },
      { to: '/planning', labelKey: 'nav.planning', requiredCapability: 'EDIT_FLIGHTS' },
      { to: '/daily-ops/alerts', labelKey: 'nav.alerts', requiredCapability: 'EDIT_FLIGHTS' },
    ],
  },

  // ── Members 360 ───────────────────────────────────────────────────────────
  {
    to: '/club/members',
    labelKey: 'nav.members',
    requiredCapability: 'MANAGE_USERS',
    children: [
      { to: '/club/members/core', labelKey: 'nav.directory', requiredCapability: 'MANAGE_USERS' },
      { to: '/club/commissions', labelKey: 'nav.committees', requiredCapability: 'MANAGE_USERS' },
      { to: '/club/sheets', labelKey: 'nav.sheets', requiredCapability: 'MANAGE_USERS' },
      { to: '/member-portal/renewal', labelKey: 'nav.onlineRenewal', requiredCapability: 'MANAGE_USERS' },
    ],
  },

  // ── Finance ───────────────────────────────────────────────────────────────
  {
    to: '/banque',
    labelKey: 'nav.finance',
    requiredCapability: 'VIEW_FINANCIALS',
    children: [
      { to: '/banque', labelKey: 'nav.banqueOverview' },
      { to: '/banque/operations', labelKey: 'nav.banqueOps' },
      { to: '/banque/journal', labelKey: 'nav.banqueJournal' },
      { to: '/banque/fiscal-years', labelKey: 'nav.banqueFiscalYears' },
      { to: '/banque/pcg', labelKey: 'nav.banquePcg' },
      { to: '/banque/pricing', labelKey: 'nav.banquePricing' },
      { to: '/banque/reports', labelKey: 'nav.banqueReports' },
      { to: '/banque/settings/journals', labelKey: 'nav.banqueSettings', requiredCapability: 'MANAGE_ACCOUNTING_SETTINGS' },
    ],
  },

  // ── Assets (Flotte) ───────────────────────────────────────────────────────
  {
    to: '/assets',
    labelKey: 'nav.assets',
    requiredCapability: 'MANAGE_ASSETS',
    children: [
      { to: '/assets', labelKey: 'nav.equipment', requiredCapability: 'MANAGE_ASSETS' },
      { to: '/assets/types', labelKey: 'nav.assetTypes', requiredCapability: 'MANAGE_ASSETS' },
      { to: '/assets/types', labelKey: 'nav.assetPricing', requiredCapability: 'MANAGE_PRICES' },
    ],
  },

  // ── Sales & Suppliers ─────────────────────────────────────────────────────
  {
    to: '/banque/operations',
    labelKey: 'nav.salesSuppliers',
    requiredCapability: 'VIEW_FINANCIALS',
    children: [
      { to: '/banque/operations', labelKey: 'nav.memberSales' },
      { to: '/banque/factures-fournisseurs', labelKey: 'nav.supplierInvoices' },
    ],
  },

  // ── Integrations ──────────────────────────────────────────────────────────
  {
    to: '/planche',
    labelKey: 'nav.integrations',
    children: [
      { to: '/planche/members-push', labelKey: 'nav.plancheMembersPush', requiredCapability: 'MANAGE_PLANCHE' },
      { to: '/planche/machines-push', labelKey: 'nav.plancheMachinesPush', requiredCapability: 'MANAGE_PLANCHE' },
      { to: '/planche/vi-sync', labelKey: 'nav.plancheViSync', requiredCapability: 'MANAGE_PLANCHE' },
      { to: '/planche/flights-fetch', labelKey: 'nav.plancheFlightsFetch', requiredCapability: 'MANAGE_PLANCHE' },
      { to: '/helloasso/purchases', labelKey: 'nav.helloassoPurchases', requiredCapability: 'HELLOASSO' },
      { to: '/helloasso/vi-import', labelKey: 'nav.helloassoViImport', requiredCapability: 'HELLOASSO' },
      { to: '/integrations/gesasso', labelKey: 'nav.gesassoSync', requiredCapability: 'MANAGE_SYSTEM_SETTINGS' },
      { to: '/integrations/osrt', labelKey: 'nav.osrtSync', requiredCapability: 'MANAGE_SYSTEM_SETTINGS' },
    ],
  },

  // ── Reporting (Budgets) ───────────────────────────────────────────────────
  { to: '/banque/reports', labelKey: 'nav.reporting', requiredCapability: 'VIEW_FINANCIALS' },

  // ── Administration ────────────────────────────────────────────────────────
  {
    to: '/admin',
    labelKey: 'nav.administration',
    requiredCapability: 'MANAGE_USERS',
    children: [
      { to: '/admin', labelKey: 'nav.admin', requiredCapability: 'MANAGE_USERS' },
      { to: '/helloasso/integration', labelKey: 'nav.configHelloasso', requiredCapability: 'MANAGE_SYSTEM_SETTINGS' },
      { to: '/planche/integration', labelKey: 'nav.configPlanche', requiredCapability: 'MANAGE_SYSTEM_SETTINGS' },
      { to: '/storage/settings', labelKey: 'nav.configStorage', requiredCapability: 'MANAGE_SYSTEM_SETTINGS' },
      { to: '/banque/settings/journals', labelKey: 'nav.configBanque', requiredCapability: 'MANAGE_SYSTEM_SETTINGS' },
    ],
  },
]
