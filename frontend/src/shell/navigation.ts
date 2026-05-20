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
    requiredCapability: 'HELLOASSO',
    children: [
      { to: '/helloasso/purchases', labelKey: 'nav.helloassoPurchases', requiredCapability: 'HELLOASSO' },
      { to: '/helloasso/vi-import', labelKey: 'nav.helloassoViImport', requiredCapability: 'HELLOASSO' },
    ],
  },
  {
    to: '/planche',
    labelKey: 'nav.planche',
    requiredCapability: 'MANAGE_PLANCHE',
    children: [
      { to: '/planche/members-push', labelKey: 'nav.plancheMembersPush', requiredCapability: 'MANAGE_PLANCHE' },
      { to: '/planche/machines-push', labelKey: 'nav.plancheMachinesPush', requiredCapability: 'MANAGE_PLANCHE' },
      { to: '/planche/vi-sync', labelKey: 'nav.plancheViSync', requiredCapability: 'MANAGE_PLANCHE' },
    ],
  },
  {
    to: '/vi',
    labelKey: 'nav.vi',
    children: [
      { to: '/vi/entitlements', labelKey: 'nav.viEntitlements', requiredCapability: 'MANAGE_VI' },
      { to: '/vi/types', labelKey: 'nav.viTypes', requiredCapability: 'MANAGE_VI' },
      { to: '/vi/planning', labelKey: 'nav.viPlanning', requiredCapability: 'PLAN_VI' },
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
    ],
  },
  {
    to: '/admin',
    labelKey: 'nav.admin',
    children: [
      { to: '/admin', labelKey: 'nav.admin', requiredCapability: 'MANAGE_USERS' },
      { to: '/helloasso/integration', labelKey: 'nav.configHelloasso', requiredCapability: 'MANAGE_SYSTEM_SETTINGS' },
      { to: '/planche/integration', labelKey: 'nav.configPlanche', requiredCapability: 'MANAGE_SYSTEM_SETTINGS' },
      { to: '/storage/settings', labelKey: 'nav.configStorage', requiredCapability: 'MANAGE_SYSTEM_SETTINGS' },
      { to: '/banque/settings/journals', labelKey: 'nav.configBanque', requiredCapability: 'MANAGE_SYSTEM_SETTINGS' },
    ],
  },
]
