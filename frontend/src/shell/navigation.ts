export type ShellNavItem = {
  to: string
  labelKey: string
  requiredCapability?: string
  /** Optional sub-routes shown when this group is active in the sidebar */
  children?: Array<{ to: string; labelKey: string; requiredCapability?: string }>
}

/**
 * Navigation structure ordered by business usage frequency.
 *
 * Groups (8 vs 15 previously):
 *   1. Vols & Facturation
 *   2. VI & HelloAsso
 *   3. Planning
 *   4. Membres
 *   5. Finance (unified: banking + sales + purchases + accounting + pricing)
 *   6. RH
 *   7. Machines
 *   8. Administration (absorbs integrations config)
 *
 * Removed from nav:
 *   - Portail membres (external access, separate auth — use /member-portal/login directly)
 *   - Bilans (duplicate of Finance > Comptabilité > Rapports)
 *   - Intégrations standalone group (absorbed into Administration)
 */
export const shellNavItems: ShellNavItem[] = [
  // ── 0. Tableau de bord ────────────────────────────────────────────────────
  { to: '/dashboard', labelKey: 'nav.dashboard' },

  // ── 1. Vols & Facturation (priorité #1) ───────────────────────────────────
  {
    to: '/workspace/flights',
    labelKey: 'nav.billingFlights',
    requiredCapability: 'EDIT_FLIGHTS',
    children: [
      { to: '/workspace/flights', labelKey: 'nav.flights', requiredCapability: 'EDIT_FLIGHTS' },
      { to: '/workspace/flights?tab=packs', labelKey: 'nav.packs', requiredCapability: 'MANAGE_PRICES' },
      { to: '/workspace/flights?tab=gesasso', labelKey: 'nav.gesassoSync', requiredCapability: 'FEDERAL_SYNC' },
      { to: '/workspace/flights?tab=osrt', labelKey: 'nav.osrtSync', requiredCapability: 'FEDERAL_SYNC' },
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
      { to: '/workspace/vi?tab=vols', labelKey: 'nav.viFlights' },
      { to: '/workspace/vi?tab=achats', labelKey: 'nav.helloassoPurchases', requiredCapability: 'HELLOASSO' },
      { to: '/workspace/vi?tab=import', labelKey: 'nav.helloassoViImport', requiredCapability: 'HELLOASSO' },
      { to: '/workspace/vi?tab=sync', labelKey: 'nav.plancheViSync', requiredCapability: 'MANAGE_PLANCHE' },
    ],
  },

  // ── 3. Planning (priorité #3) ──────────────────────────────────────────────
  { to: '/planning', labelKey: 'nav.planning' },

  // ── 4. Membres (priorité #4) ──────────────────────────────────────────────
  // Fiches tab removed — annual config absorbed into Réinscription (Phase C)
  {
    to: '/workspace/members',
    labelKey: 'nav.members',
    requiredCapability: 'MANAGE_USERS',
    children: [
      { to: '/workspace/members', labelKey: 'nav.directory', requiredCapability: 'MANAGE_USERS' },
      { to: '/workspace/members?tab=commissions', labelKey: 'nav.committees', requiredCapability: 'MANAGE_USERS' },
      { to: '/workspace/members?tab=reinscription', labelKey: 'nav.onlineRenewal', requiredCapability: 'MANAGE_USERS' },
      { to: '/planche/members-push', labelKey: 'nav.plancheMembersPush', requiredCapability: 'MANAGE_PLANCHE' },
    ],
  },

  // ── 5. Finance — workspace unifié (priorité #5) ────────────────────────────
  {
    to: '/workspace/finance',
    labelKey: 'nav.finance',
    requiredCapability: 'VIEW_FINANCIALS',
    children: [
      { to: '/workspace/finance', labelKey: 'nav.financeOverview' },
      { to: '/workspace/finance?tab=ventes', labelKey: 'nav.financeSales' },
      { to: '/workspace/finance?tab=achats', labelKey: 'nav.financeAchats' },
      { to: '/workspace/finance?tab=comptabilite', labelKey: 'nav.financeComptabilite' },
    ],
  },

  // ── 5b. Rapports financiers (priorité #5b) ─────────────────────────────────
  {
    to: '/workspace/reports',
    labelKey: 'nav.reportsSection',
    requiredCapability: 'VIEW_FINANCIALS',
    children: [
      { to: '/workspace/reports', labelKey: 'nav.reportsStatements' },
      { to: '/workspace/reports?tab=grand-livre', labelKey: 'nav.reportsLedger' },
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

  // ── 9b. Carburant ──────────────────────────────────────────────────────────
  {
    to: '/workspace/carburant',
    labelKey: 'nav.carburant',
    requiredCapability: 'MANAGE_CARBURANT',
    children: [
      { to: '/workspace/carburant', labelKey: 'nav.carburantPompes', requiredCapability: 'MANAGE_CARBURANT' },
    ],
  },

  // ── 7. Tarifs (priorité #7) ───────────────────────────────────────────────
  // Regroupe les quatre facettes de la tarification :
  //   - Génériques (versions non liées à un type d'actif)
  //   - Machines (par type d'actif)
  //   - Forfaits (catalogue de packs)
  //   - Types de vol (catégories de vol pour les lignes de tarif)
  {
    to: '/workspace/tarifs',
    labelKey: 'nav.tarifs',
    requiredCapability: 'MANAGE_PRICES',
    children: [
      { to: '/workspace/tarifs', labelKey: 'nav.tarifsGrid', requiredCapability: 'MANAGE_PRICES' },
      { to: '/workspace/tarifs?tab=machines', labelKey: 'nav.tarifsMachines', requiredCapability: 'MANAGE_PRICES' },
      { to: '/workspace/tarifs?tab=packs', labelKey: 'nav.tarifsPacks', requiredCapability: 'MANAGE_PRICES' },
      { to: '/workspace/tarifs?tab=flight-types', labelKey: 'nav.tarifsFlightTypes', requiredCapability: 'MANAGE_PRICES' },
    ],
  },

  // ── 8. Machines (priorité #8) ─────────────────────────────────────────────
  {
    to: '/workspace/machines',
    labelKey: 'nav.machines',
    requiredCapability: 'MANAGE_ASSETS',
    children: [
      { to: '/workspace/machines', labelKey: 'nav.equipment', requiredCapability: 'MANAGE_ASSETS' },
      { to: '/workspace/machines?tab=families', labelKey: 'nav.assetFamilies', requiredCapability: 'MANAGE_ASSETS' },
      { to: '/planche/machines-push', labelKey: 'nav.plancheMachinesPush', requiredCapability: 'MANAGE_PLANCHE' },
    ],
  },

  // ── 10. Administration (priorité #10) ─────────────────────────────────────
  // Paramètres système absorbés dans /admin?tab=parametres&subtab=xxx
  {
    to: '/admin',
    labelKey: 'nav.administration',
    requiredCapability: 'MANAGE_USERS',
    children: [
      { to: '/admin', labelKey: 'nav.admin', requiredCapability: 'MANAGE_USERS' },
      { to: '/admin/audit', labelKey: 'nav.adminAudit', requiredCapability: 'MANAGE_USERS' },
      { to: '/admin?tab=parametres&subtab=exercices', labelKey: 'nav.configExercices', requiredCapability: 'MANAGE_SYSTEM_SETTINGS' },
      { to: '/admin?tab=parametres&subtab=pcg', labelKey: 'nav.configPcg', requiredCapability: 'MANAGE_SYSTEM_SETTINGS' },
      { to: '/admin?tab=parametres&subtab=finance', labelKey: 'nav.configFinance', requiredCapability: 'MANAGE_SYSTEM_SETTINGS' },
      { to: '/admin?tab=parametres&subtab=helloasso', labelKey: 'nav.configHelloasso', requiredCapability: 'MANAGE_SYSTEM_SETTINGS' },
      { to: '/admin?tab=parametres&subtab=planche', labelKey: 'nav.configPlanche', requiredCapability: 'MANAGE_SYSTEM_SETTINGS' },
      { to: '/admin?tab=parametres&subtab=gesasso', labelKey: 'nav.configGesasso', requiredCapability: 'MANAGE_SYSTEM_SETTINGS' },
      { to: '/admin?tab=parametres&subtab=stockage', labelKey: 'nav.configStorage', requiredCapability: 'MANAGE_SYSTEM_SETTINGS' },
    ],
  },
]
