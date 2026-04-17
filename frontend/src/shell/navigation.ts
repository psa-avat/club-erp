export type ShellNavItem = {
  to: string
  labelKey: string
  requiredCapability?: string
}

export const shellNavItems: ShellNavItem[] = [
  { to: '/dashboard', labelKey: 'nav.dashboard' },
  { to: '/club', labelKey: 'nav.club', requiredCapability: 'MEMBER_PORTAL' },
  { to: '/planning', labelKey: 'nav.planning', requiredCapability: 'EDIT_FLIGHTS' },
  { to: '/banque', labelKey: 'nav.banque', requiredCapability: 'VIEW_FINANCIALS' },
  { to: '/admin', labelKey: 'nav.admin', requiredCapability: 'MANAGE_USERS' },
]
