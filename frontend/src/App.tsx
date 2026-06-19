import { Navigate, Route, Routes, useParams } from 'react-router-dom'

import { LoginPage, ProtectedRoute, PublicOnlyRoute } from './auth'
import {
  LoginPage as MemberPortalLoginPage,
  PortalShell,
} from './modules/member-portal'
import { getPortalProfile } from './modules/member-portal/api/client'
import { AdminPage } from './modules/admin'
import {
  BanqueJournalEntryWorkspacePage,
  BanqueSettingsPage,
  BankPricingVersionEditPage,
  SupplierInvoicePage,
  PackDefinitionEditPage,
  FinanceWorkspacePage,
  TarifsWorkspacePage,
} from './modules/banque'
import { DashboardPage } from './modules/dashboard'
import { MembersListPage, MemberFormPage, MemberWorkspaceShell, MembersWorkspacePage } from './modules/members'
import { AssetDetailPage, AssetFormPage, AssetPricingPage, MachinesWorkspacePage } from './modules/assets'
import { PlanningPage } from './modules/planning'
import { FlightsWorkspacePage } from './modules/flights'
import { PlancheMachinesPushPage, PlancheMembersPushPage } from './modules/planche'
import { ViWorkspacePage } from './modules/vi'
import { RhWorkspacePage } from './modules/rh'
import { PlaceholderPage } from './components/ui/PlaceholderPage'
import { AppShell } from './shell/components'

// ── Route wrappers for MemberWorkspaceShell ──

function MemberWorkspaceClubRoute() {
  const { memberUuid } = useParams<{ memberUuid: string }>()
  if (!memberUuid) return null
  return <MemberWorkspaceShell mode="club" memberUuid={memberUuid} />
}

function MemberWorkspacePortalRoute() {
  const profile = getPortalProfile<{ uuid: string }>()
  if (!profile) return null
  return <MemberWorkspaceShell mode="portal" memberUuid={profile.uuid} />
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate replace to="/dashboard" />} />

      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>

      {/* ── Member portal (standalone, outside ERP auth guard) ── */}
      <Route path="/member-portal/login" element={<MemberPortalLoginPage />} />
      <Route element={<PortalShell />}>
        <Route path="/member-portal/workspace" element={<MemberWorkspacePortalRoute />} />
        <Route path="/member-portal/*" element={<Navigate to="/member-portal/workspace" replace />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          {/* ── 1. Dashboard ── */}
          <Route path="/dashboard" element={<DashboardPage />} />

          {/* ── 2. Members ── */}
          <Route path="/club" element={<Navigate replace to="/workspace/members" />} />
          <Route path="/club/members" element={<Navigate replace to="/workspace/members" />} />
          <Route path="/workspace/members" element={<MembersWorkspacePage />} />
          <Route path="/club/members/:screen" element={<MembersListPage />} />
          <Route path="/club/members/new" element={<MemberFormPage />} />
          <Route path="/club/members/:memberUuid/edit" element={<MemberFormPage />} />
          <Route path="/club/members/:memberUuid/workspace" element={<MemberWorkspaceClubRoute />} />
          <Route path="/club/members/:memberUuid/pilot-sheet" element={<Navigate replace to="/workspace/members" />} />
          <Route path="/club/commissions" element={<Navigate replace to="/workspace/members?tab=commissions" />} />
          <Route path="/club/sheets" element={<Navigate replace to="/workspace/members?tab=reinscription" />} />
          <Route path="/daily-ops/alerts" element={<PlaceholderPage title="Alertes & Tâches" description="Tableau de bord des alertes, notifications et tâches en attente." eta="Phase 10" />} />
          <Route path="/member-portal/renewal" element={<Navigate replace to="/workspace/members?tab=reinscription" />} />

          {/* ── 3. Sales (MVP) ── */}
          <Route path="/sales" element={<Navigate replace to="/workspace/finance?tab=ventes" />} />
          <Route path="/workspace/sales" element={<Navigate replace to="/workspace/finance?tab=ventes" />} />
          <Route path="/banque/packs" element={<Navigate replace to="/pricing" />} />
          <Route path="/banque/packs/:packUuid" element={<PackDefinitionEditPage />} />
          <Route path="/banque/factures-fournisseurs/new" element={<SupplierInvoicePage />} />

          {/* ── 4. Assets & VI ── */}
          <Route path="/assets" element={<Navigate replace to="/workspace/machines" />} />
          <Route path="/workspace/machines" element={<MachinesWorkspacePage />} />
          <Route path="/assets/types" element={<Navigate replace to="/workspace/machines?tab=types" />} />
          <Route path="/assets/new" element={<AssetFormPage />} />
          <Route path="/assets/:uuid" element={<AssetDetailPage />} />
          <Route path="/assets/:uuid/edit" element={<AssetFormPage />} />
          <Route path="/assets/:uuid/pricing" element={<AssetPricingPage />} />
          <Route path="/vi" element={<Navigate replace to="/vi/entitlements" />} />
          <Route path="/vi/entitlements" element={<Navigate replace to="/workspace/vi" />} />
          <Route path="/vi/types" element={<Navigate replace to="/workspace/vi?tab=types" />} />
          <Route path="/vi/planning" element={<Navigate replace to="/workspace/vi?tab=planning" />} />
          <Route path="/workspace/vi" element={<ViWorkspacePage />} />

          {/* ── 5. Flights & Planche (Planche sync included) ── */}
          <Route path="/flights" element={<Navigate replace to="/workspace/flights" />} />
          <Route path="/flights/billing" element={<Navigate replace to="/workspace/flights?tab=facturation" />} />
          <Route path="/workspace/flights" element={<FlightsWorkspacePage />} />
          <Route path="/planche" element={<Navigate replace to="/planche/members-push" />} />
          <Route path="/planche/integration" element={<Navigate replace to="/admin?tab=parametres&subtab=planche" />} />
          <Route path="/planche/members-push" element={<PlancheMembersPushPage />} />
          <Route path="/planche/machines-push" element={<PlancheMachinesPushPage />} />
          <Route path="/planche/vi-sync" element={<Navigate replace to="/workspace/vi?tab=sync" />} />
          <Route path="/planche/flights-fetch" element={<Navigate replace to="/workspace/flights?tab=sync" />} />
          <Route path="/planning" element={<PlanningPage />} />

          {/* ── 6. Integrations (HelloAsso, Gesasso, OSRT) ── */}
          <Route path="/helloasso" element={<Navigate replace to="/helloasso/purchases" />} />
          <Route path="/helloasso/integration" element={<Navigate replace to="/admin?tab=parametres&subtab=helloasso" />} />
          <Route path="/helloasso/purchases" element={<Navigate replace to="/workspace/vi?tab=achats" />} />
          <Route path="/helloasso/vi-import" element={<Navigate replace to="/workspace/vi?tab=import" />} />
          <Route path="/integrations/gesasso" element={<PlaceholderPage title="Gesasso" description="Synchronisation avec Gesasso pour la gestion des envois postaux." eta="Phase 8" />} />
          <Route path="/integrations/osrt" element={<PlaceholderPage title="OSRT" description="Synchronisation avec OSRT pour les temps machine." eta="Phase 8" />} />

          {/* ── 7. Finance & Accounting ── */}
          <Route path="/banque" element={<Navigate replace to="/workspace/finance" />} />
          <Route path="/workspace/banque" element={<Navigate replace to="/workspace/finance" />} />
          <Route path="/banque/dashboard" element={<Navigate replace to="/workspace/finance" />} />
          <Route path="/banque/operations" element={<Navigate replace to="/workspace/finance" />} />
          <Route path="/banque/facturation-membres" element={<Navigate replace to="/workspace/finance?tab=ventes" />} />
          <Route path="/banque/journal" element={<Navigate replace to="/workspace/finance?tab=comptabilite&subtab=journal" />} />
          <Route path="/banque/journal/entries" element={<Navigate replace to="/workspace/finance?tab=comptabilite&subtab=journal" />} />
          <Route path="/banque/journal/entry/new" element={<BanqueJournalEntryWorkspacePage />} />
          <Route path="/banque/journal/entry/:entryUuid" element={<BanqueJournalEntryWorkspacePage />} />
          <Route path="/banque/journal/templates" element={<Navigate replace to="/workspace/finance?tab=recurring" />} />
          <Route path="/banque/accounts" element={<Navigate replace to="/workspace/finance?tab=comptabilite&subtab=comptes" />} />
          <Route path="/banque/pcg" element={<Navigate replace to="/workspace/finance?tab=comptabilite&subtab=pcg" />} />
          <Route path="/banque/fiscal-years" element={<Navigate replace to="/workspace/finance?tab=comptabilite&subtab=exercices" />} />
          <Route path="/banque/pricing" element={<Navigate replace to="/workspace/tarifs" />} />
          <Route path="/banque/pricing/versions/:fiscalYearUuid/:versionUuid/edit" element={<BankPricingVersionEditPage />} />
          <Route path="/banque/reports" element={<Navigate replace to="/workspace/finance?tab=comptabilite&subtab=rapports" />} />
          <Route path="/banque/reconciliation" element={<Navigate replace to="/workspace/finance?tab=rapprochement" />} />
          <Route path="/banque/settings/:section" element={<BanqueSettingsPage />} />
          <Route path="/pricing" element={<Navigate replace to="/banque/pricing" />} />
          <Route path="/workspace/purchases" element={<Navigate replace to="/workspace/finance?tab=achats" />} />
          <Route path="/workspace/accounting" element={<Navigate replace to="/workspace/finance?tab=comptabilite" />} />

          {/* ── 8. Admin ── */}
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/audit" element={<PlaceholderPage title="Journal d'audit" description="Consultez l'historique complet des actions et modifications dans le système." eta="Phase 11" />} />
          <Route path="/rh" element={<PlaceholderPage title="RH" description="Planning des congés, gestion des présences et tableau de bord RH." eta="Phase 10" />} />
          <Route path="/workspace/rh" element={<RhWorkspacePage />} />
          <Route path="/workspace/finance" element={<FinanceWorkspacePage />} />
          <Route path="/workspace/tarifs" element={<TarifsWorkspacePage />} />
          <Route path="/storage" element={<Navigate replace to="/admin?tab=parametres&subtab=stockage" />} />
          <Route path="/storage/settings" element={<Navigate replace to="/admin?tab=parametres&subtab=stockage" />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate replace to="/dashboard" />} />
    </Routes>
  )
}

export default App
