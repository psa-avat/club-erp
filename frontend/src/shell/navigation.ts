export type ShellNavItem = {
  to: string
  labelKey: string
  requiredCapability?: string
  /** Optional sub-routes shown when this group is active in the sidebar */
  children?: Array<{ to: string; labelKey: string; requiredCapability?: string }>
}

export const shellNavItems: ShellNavItem[] = [
  { to: '/dashboard', labelKey: 'nav.dashboard' },
  {
    to: '/club',
    labelKey: 'nav.club',
    children: [
      { to: '/club/members', labelKey: 'nav.clubMembers', requiredCapability: 'MANAGE_USERS' },
      { to: '/club/commissions', labelKey: 'nav.clubCommissionsManagement', requiredCapability: 'MANAGE_USERS' },
      { to: '/club/sheets', labelKey: 'nav.clubSheets', requiredCapability: 'MANAGE_USERS' },
      { to: '/assets', labelKey: 'nav.assets', requiredCapability: 'MANAGE_ASSETS' },
    ],
  },
  { to: '/planning', labelKey: 'nav.planning', requiredCapability: 'EDIT_FLIGHTS' },
  {
    to: '/helloasso',
    labelKey: 'nav.helloasso',
    requiredCapability: 'MANAGE_ACCOUNTING_SETTINGS',
    children: [
      { to: '/helloasso/integration', labelKey: 'nav.helloassoIntegration', requiredCapability: 'MANAGE_ACCOUNTING_SETTINGS' },
      { to: '/helloasso/purchases', labelKey: 'nav.helloassoPurchases', requiredCapability: 'MANAGE_ACCOUNTING_SETTINGS' },
    ],
  },
  {
    to: '/planche',
    labelKey: 'nav.planche',
    requiredCapability: 'MANAGE_ACCOUNTING_SETTINGS',
    children: [
      { to: '/planche/integration', labelKey: 'nav.plancheIntegration', requiredCapability: 'MANAGE_ACCOUNTING_SETTINGS' },
    ],
  },
  {
    to: '/storage',
    labelKey: 'nav.storage',
    requiredCapability: 'MANAGE_SYSTEM_SETTINGS',
    children: [
      { to: '/storage/settings', labelKey: 'nav.storageSettings', requiredCapability: 'MANAGE_SYSTEM_SETTINGS' },
    ],
  },
  {
    to: '/banque',
    labelKey: 'nav.banque',
    requiredCapability: 'VIEW_FINANCIALS',
    children: [
      { to: '/banque', labelKey: 'nav.banqueOverview' },
      { to: '/banque/operations', labelKey: 'nav.banqueOps' },
      { to: '/banque/journal', labelKey: 'nav.banqueJournal' },
      { to: '/banque/pricing', labelKey: 'nav.banquePricing' },
      { to: '/banque/fiscal-years', labelKey: 'nav.banqueFiscalYears' },
      { to: '/banque/pcg', labelKey: 'nav.banquePcg' },
      { to: '/banque/settings/journals', labelKey: 'nav.banqueSettings' },
    ],
  },
  { to: '/admin', labelKey: 'nav.admin', requiredCapability: 'MANAGE_USERS' },
]
