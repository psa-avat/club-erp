export type ShellNavItem = {
  to: string
  labelKey: string
  requiredCapability?: string
  /** Optional sub-routes shown when this group is active in the sidebar */
  children?: Array<{ to: string; labelKey: string }>
}

export const shellNavItems: ShellNavItem[] = [
  { to: '/dashboard', labelKey: 'nav.dashboard' },
  {
    to: '/club',
    labelKey: 'nav.club',
    requiredCapability: 'MANAGE_USERS',
    children: [
      { to: '/club/members', labelKey: 'nav.clubMembers' },
      { to: '/club/committees', labelKey: 'nav.clubCommittees' },
      { to: '/club/sheets', labelKey: 'nav.clubSheets' },
    ],
  },
  { to: '/planning', labelKey: 'nav.planning', requiredCapability: 'EDIT_FLIGHTS' },
  {
    to: '/banque',
    labelKey: 'nav.banque',
    requiredCapability: 'VIEW_FINANCIALS',
    children: [
      { to: '/banque', labelKey: 'nav.banqueOverview' },
      { to: '/banque/journal', labelKey: 'nav.banqueJournal' },
      { to: '/banque/pricing', labelKey: 'nav.banquePricing' },
      { to: '/banque/pcg', labelKey: 'nav.banquePcg' },
      { to: '/banque/settings/journals', labelKey: 'nav.banqueSettings' },
    ],
  },
  { to: '/assets', labelKey: 'nav.assets', requiredCapability: 'MANAGE_ASSETS' },
  { to: '/admin', labelKey: 'nav.admin', requiredCapability: 'MANAGE_USERS' },
]
