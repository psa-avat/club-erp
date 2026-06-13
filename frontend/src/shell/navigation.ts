export type ShellNavItem = {
  to: string
  labelKey: string
  requiredCapability?: string
  /** Optional sub-routes shown when this group is active in the sidebar */
  children?: Array<{ to: string; labelKey: string; requiredCapability?: string }>
}

/**
 * Navigation structure ordonnée par fréquence d'usage métier
 * (déclarée par les utilisateurs — voir docs/PROMPT_MIGRATION_DESIGN.md).
 *
 * Fréquence décroissante :
 *   1. Facturation des vols (Packs, Gesasso, OSRT)
 *   2. Gestion des VI (HelloAsso)
 *   3. Planning activité
 *   4. Gestion des membres (adhésions)
 *   5. Portail membres (logbooks / balance / dépenses)
 *   6. Ventes
 *   7. Achats
 *   8. Banque / écritures récurrentes
 *   9. RH (planning / congés)
 *  10. Compta (états / écritures)
 *  11. Machines (gestion de la dispo)
 *  12. Gestion des tarifs
 *  13. Bilans
 *  14. Admin / Configurations
 *
 * Chaque entrée peut être filtrée dynamiquement par requiredCapability.
 */
export const shellNavItems: ShellNavItem[] = [
  // ── 0. Tableau de bord ────────────────────────────────────────────────────
  { to: '/dashboard', labelKey: 'nav.dashboard' },

  // ── 1. Facturation & Vols (priorité #1) ───────────────────────────────────
  {
    to: '/workspace/flights',
    labelKey: 'nav.billingFlights',
    requiredCapability: 'EDIT_FLIGHTS',
    children: [
      { to: '/workspace/flights', labelKey: 'nav.flights', requiredCapability: 'EDIT_FLIGHTS' },
      { to: '/workspace/flights?tab=facturation', labelKey: 'nav.flightsBilling', requiredCapability: 'VIEW_FINANCIALS' },
      { to: '/workspace/flights?tab=packs', labelKey: 'nav.packs', requiredCapability: 'MANAGE_PRICES' },
      { to: '/workspace/flights?tab=gesasso', labelKey: 'nav.gesassoSync', requiredCapability: 'MANAGE_SYSTEM_SETTINGS' },
      { to: '/workspace/flights?tab=osrt', labelKey: 'nav.osrtSync', requiredCapability: 'MANAGE_SYSTEM_SETTINGS' },
      { to: '/workspace/flights?tab=sync', labelKey: 'nav.plancheFlightsFetch', requiredCapability: 'MANAGE_PLANCHE' },
    ],
  },

  // ── 2. VI & HelloAsso (priorité #2) ───────────────────────────────────────
  {
    to: '/workspace/vi',
    labelKey: 'nav.viHelloasso',
    children: [
      { to: '/workspace/vi', labelKey: 'nav.viEntitlements' },
      { to: '/workspace/vi?tab=types', labelKey: 'nav.viTypes' },
      { to: '/workspace/vi?tab=planning', labelKey: 'nav.viPlanning' },
      { to: '/workspace/vi?tab=achats', labelKey: 'nav.helloassoPurchases', requiredCapability: 'HELLOASSO' },
      { to: '/workspace/vi?tab=import', labelKey: 'nav.helloassoViImport', requiredCapability: 'HELLOASSO' },
      { to: '/workspace/vi?tab=sync', labelKey: 'nav.plancheViSync', requiredCapability: 'MANAGE_PLANCHE' },
    ],
  },

  // ── 3. Planning (priorité #3) ──────────────────────────────────────────────
  { to: '/planning', labelKey: 'nav.planning' },

  // ── 4. Membres (priorité #4) ──────────────────────────────────────────────
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

  // ── 5. Portail membres (priorité #5) ───────────────────────────────────────
  {
    to: '/member-portal/workspace',
    labelKey: 'nav.memberPortal',
    children: [
      { to: '/member-portal/workspace', labelKey: 'nav.portalDashboard' },
      { to: '/member-portal/workspace?tab=logbook', labelKey: 'nav.portalLogbook' },
      { to: '/member-portal/workspace?tab=account', labelKey: 'nav.portalAccount' },
      { to: '/member-portal/workspace?tab=packs', labelKey: 'nav.portalPacks' },
      { to: '/member-portal/workspace?tab=availability', labelKey: 'nav.portalAvailability' },
    ],
  },

  // ── 6. Ventes (priorité #6) ────────────────────────────────────────────────
  {
    to: '/workspace/finance',
    labelKey: 'nav.sales',
    requiredCapability: 'VIEW_FINANCIALS',
    children: [
      { to: '/workspace/finance?tab=operations', labelKey: 'nav.memberSales' },
      { to: '/workspace/finance?tab=operations', labelKey: 'nav.salesInvoices' },
      { to: '/workspace/finance?tab=operations', labelKey: 'nav.salesPayments' },
    ],
  },

  // ── 7. Achats (priorité #7) ────────────────────────────────────────────────
  {
    to: '/workspace/purchases',
    labelKey: 'nav.purchases',
    requiredCapability: 'VIEW_FINANCIALS',
    children: [
      { to: '/workspace/purchases', labelKey: 'nav.supplierInvoices' },
      { to: '/workspace/purchases?tab=fournisseurs', labelKey: 'nav.supplierDirectory' },
    ],
  },

  // ── 8. Banque (priorité #8) ────────────────────────────────────────────────
  {
    to: '/workspace/finance',
    labelKey: 'nav.banking',
    requiredCapability: 'VIEW_FINANCIALS',
    children: [
      { to: '/workspace/finance', labelKey: 'nav.banqueOverview' },
      { to: '/workspace/finance?tab=operations', labelKey: 'nav.banqueOps' },
      { to: '/workspace/finance?tab=packs', labelKey: 'nav.packs' },
      { to: '/workspace/finance?tab=recurring', labelKey: 'nav.banqueRecurring' },
      { to: '/workspace/finance?tab=rapprochement', labelKey: 'nav.banqueReconciliation' },
    ],
  },

  // ── 9. RH (priorité #9) ────────────────────────────────────────────────────
  {
    to: '/workspace/rh',
    labelKey: 'nav.rh',
    children: [
      { to: '/workspace/rh', labelKey: 'nav.rhPlanning' },
      { to: '/workspace/rh?tab=presences', labelKey: 'nav.rhAttendance' },
      { to: '/workspace/rh?tab=equipe', labelKey: 'nav.rhTeam' },
    ],
  },

  // ── 10. Comptabilité (priorité #10) ────────────────────────────────────────
  {
    to: '/workspace/accounting',
    labelKey: 'nav.accounting',
    requiredCapability: 'VIEW_FINANCIALS',
    children: [
      { to: '/workspace/accounting', labelKey: 'nav.banqueJournal' },
      { to: '/workspace/accounting?tab=exercices', labelKey: 'nav.banqueFiscalYears' },
      { to: '/workspace/accounting?tab=pcg', labelKey: 'nav.banquePcg' },
      { to: '/workspace/accounting?tab=rapports', labelKey: 'nav.banqueReports' },
    ],
  },

  // ── 11. Machines & Tarifs (priorités #11, #12) ─────────────────────────────
  {
    to: '/assets',
    labelKey: 'nav.machinesTarifs',
    requiredCapability: 'MANAGE_ASSETS',
    children: [
      { to: '/assets', labelKey: 'nav.equipment', requiredCapability: 'MANAGE_ASSETS' },
      { to: '/assets/types', labelKey: 'nav.assetTypes', requiredCapability: 'MANAGE_ASSETS' },
      { to: '/assets/types', labelKey: 'nav.assetPricing', requiredCapability: 'MANAGE_PRICES' },
    ],
  },

  // ── 12. Tarifs (priorité #12) ──────────────────────────────────────────────
  { to: '/pricing', labelKey: 'nav.pricing' },

  // ── 13. Bilans (priorité #13) ──────────────────────────────────────────────
  { to: '/banque/reports', labelKey: 'nav.reports' },

  // ── 14. Intégrations techniques ────────────────────────────────────────────
  {
    to: '/planche',
    labelKey: 'nav.integrations',
    children: [
      { to: '/planche/members-push', labelKey: 'nav.plancheMembersPush', requiredCapability: 'MANAGE_PLANCHE' },
      { to: '/planche/machines-push', labelKey: 'nav.plancheMachinesPush', requiredCapability: 'MANAGE_PLANCHE' },
      { to: '/integrations/gesasso', labelKey: 'nav.gesassoSync', requiredCapability: 'MANAGE_SYSTEM_SETTINGS' },
      { to: '/integrations/osrt', labelKey: 'nav.osrtSync', requiredCapability: 'MANAGE_SYSTEM_SETTINGS' },
    ],
  },

  // ── 15. Administration (priorité #14) ─────────────────────────────────────
  {
    to: '/admin',
    labelKey: 'nav.administration',
    requiredCapability: 'MANAGE_USERS',
    children: [
      { to: '/admin', labelKey: 'nav.admin', requiredCapability: 'MANAGE_USERS' },
      { to: '/admin/audit', labelKey: 'nav.adminAudit', requiredCapability: 'MANAGE_USERS' },
      { to: '/helloasso/integration', labelKey: 'nav.configHelloasso', requiredCapability: 'MANAGE_SYSTEM_SETTINGS' },
      { to: '/planche/integration', labelKey: 'nav.configPlanche', requiredCapability: 'MANAGE_SYSTEM_SETTINGS' },
      { to: '/storage/settings', labelKey: 'nav.configStorage', requiredCapability: 'MANAGE_SYSTEM_SETTINGS' },
      { to: '/banque/settings/journals', labelKey: 'nav.configBanque', requiredCapability: 'MANAGE_SYSTEM_SETTINGS' },
    ],
  },
]
