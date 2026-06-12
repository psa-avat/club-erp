import { Navigate, Route, Routes, useParams } from 'react-router-dom'

import { LoginPage, ProtectedRoute, PublicOnlyRoute } from './auth'
import {
  LoginPage as MemberPortalLoginPage,
  PortalShell,
} from './modules/member-portal'
import { getPortalProfile } from './modules/member-portal/api/client'
import { AdminPage } from './modules/admin'
import {
  BanquePage,
  BanqueDashboardPage,
  BanqueCoaPage,
  BanqueJournalEntriesPage,
  BanqueJournalEntryWorkspacePage,
  BanqueJournalTemplatesPage,
  BanqueSettingsPage,
  BankPricingPage,
  BankPricingVersionEditPage,
  BanquePcgPage,
  BanqueFiscalYearsPage,
  FinancialReportsPage,
  BanqueDailyOpsPage,
  MemberBulkBillingPage,
  SupplierInvoicePage,
  PackDefinitionsPage,
  PackDefinitionEditPage,
} from './modules/banque'
import { DashboardPage } from './modules/dashboard'
import { MembersListPage, MemberFormPage, CommitteesManagementPage, MemberSheetsPage, MemberWorkspaceShell, MemberPilotSheetPage } from './modules/members'
import { AssetsListPage, AssetDetailPage, AssetFormPage, AssetPricingPage, AssetTypesPage } from './modules/assets'
import { PlanningPage } from './modules/planning'
import { HelloAssoIntegrationPage, HelloAssoPurchasesPage, HelloAssoViImportPage } from './modules/helloasso'
import { FlightsPage } from './modules/flights'
import { PlancheFlightsPullPage, PlancheIntegrationPage, PlancheMachinesPushPage, PlancheMembersPushPage, PlancheViSyncPage } from './modules/planche'
import { ViEntitlementsPage, ViPlanningPage, ViTypesPage } from './modules/vi'
import { StorageSettingsPage } from './modules/storage'
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
          <Route path="/club" element={<Navigate replace to="/club/members/core" />} />
          <Route path="/club/members" element={<Navigate replace to="/club/members/core" />} />
          <Route path="/club/members/:screen" element={<MembersListPage />} />
          <Route path="/club/members/new" element={<MemberFormPage />} />
          <Route path="/club/members/:memberUuid/edit" element={<MemberFormPage />} />
          <Route path="/club/members/:memberUuid/workspace" element={<MemberWorkspaceClubRoute />} />
          <Route path="/club/members/:memberUuid/pilot-sheet" element={<MemberPilotSheetPage />} />
          <Route path="/club/commissions" element={<CommitteesManagementPage />} />
          <Route path="/club/sheets" element={<MemberSheetsPage />} />
          <Route path="/daily-ops/alerts" element={<PlaceholderPage title="Alertes & Tâches" description="Tableau de bord des alertes, notifications et tâches en attente." eta="Phase 10" />} />
          <Route path="/member-portal/renewal" element={<PlaceholderPage title="Réinscription en ligne" description="Module de réinscription pour les membres. Accessible depuis l'espace membre." eta="Phase 10" />} />

          {/* ── 3. Sales (MVP) ── */}
          <Route path="/sales" element={<Navigate replace to="/banque/operations" />} />
          <Route path="/banque/packs" element={<PackDefinitionsPage />} />
          <Route path="/banque/packs/:packUuid" element={<PackDefinitionEditPage />} />
          <Route path="/banque/factures-fournisseurs/new" element={<SupplierInvoicePage />} />

          {/* ── 4. Assets & VI ── */}
          <Route path="/assets" element={<AssetsListPage />} />
          <Route path="/assets/types" element={<AssetTypesPage />} />
          <Route path="/assets/new" element={<AssetFormPage />} />
          <Route path="/assets/:uuid" element={<AssetDetailPage />} />
          <Route path="/assets/:uuid/edit" element={<AssetFormPage />} />
          <Route path="/assets/:uuid/pricing" element={<AssetPricingPage />} />
          <Route path="/vi" element={<Navigate replace to="/vi/entitlements" />} />
          <Route path="/vi/entitlements" element={<ViEntitlementsPage />} />
          <Route path="/vi/types" element={<ViTypesPage />} />
          <Route path="/vi/planning" element={<ViPlanningPage />} />

          {/* ── 5. Flights & Planche (Planche sync included) ── */}
          <Route path="/flights" element={<FlightsPage />} />
          <Route path="/flights/billing" element={<PlaceholderPage title="Facturation des vols" description="Historique et suivi de la facturation des vols. Disponible dans une phase ultérieure." eta="Phase 6" />} />
          <Route path="/planche" element={<Navigate replace to="/planche/members-push" />} />
          <Route path="/planche/integration" element={<PlancheIntegrationPage />} />
          <Route path="/planche/members-push" element={<PlancheMembersPushPage />} />
          <Route path="/planche/machines-push" element={<PlancheMachinesPushPage />} />
          <Route path="/planche/vi-sync" element={<PlancheViSyncPage />} />
          <Route path="/planche/flights-fetch" element={<PlancheFlightsPullPage />} />
          <Route path="/planning" element={<PlanningPage />} />

          {/* ── 6. Integrations (HelloAsso, Gesasso, OSRT) ── */}
          <Route path="/helloasso" element={<Navigate replace to="/helloasso/purchases" />} />
          <Route path="/helloasso/integration" element={<HelloAssoIntegrationPage />} />
          <Route path="/helloasso/purchases" element={<HelloAssoPurchasesPage />} />
          <Route path="/helloasso/vi-import" element={<HelloAssoViImportPage />} />
          <Route path="/integrations/gesasso" element={<PlaceholderPage title="Gesasso" description="Synchronisation avec Gesasso pour la gestion des envois postaux." eta="Phase 8" />} />
          <Route path="/integrations/osrt" element={<PlaceholderPage title="OSRT" description="Synchronisation avec OSRT pour les temps machine." eta="Phase 8" />} />

          {/* ── 7. Finance & Accounting ── */}
          <Route path="/banque" element={<BanquePage />} />
          <Route path="/banque/dashboard" element={<BanqueDashboardPage />} />
          <Route path="/banque/operations" element={<BanqueDailyOpsPage />} />
          <Route path="/banque/facturation-membres" element={<MemberBulkBillingPage />} />
          <Route path="/banque/journal" element={<BanqueJournalEntriesPage />} />
          <Route path="/banque/journal/entries" element={<BanqueJournalEntriesPage />} />
          <Route path="/banque/journal/entry/new" element={<BanqueJournalEntryWorkspacePage />} />
          <Route path="/banque/journal/entry/:entryUuid" element={<BanqueJournalEntryWorkspacePage />} />
          <Route path="/banque/journal/templates" element={<BanqueJournalTemplatesPage />} />
          <Route path="/banque/accounts" element={<BanqueCoaPage />} />
          <Route path="/banque/pcg" element={<BanquePcgPage />} />
          <Route path="/banque/fiscal-years" element={<BanqueFiscalYearsPage />} />
          <Route path="/banque/pricing" element={<BankPricingPage />} />
          <Route path="/banque/pricing/versions/:fiscalYearUuid/:versionUuid/edit" element={<BankPricingVersionEditPage />} />
          <Route path="/banque/reports" element={<FinancialReportsPage />} />
          <Route path="/banque/reconciliation" element={<PlaceholderPage title="Rapprochement bancaire" description="Import relevé bancaire, matching avec les écritures, et résolution des écarts." eta="Phase 9" />} />
          <Route path="/banque/settings/:section" element={<BanqueSettingsPage />} />
          <Route path="/pricing" element={<Navigate replace to="/banque/pricing" />} />

          {/* ── 8. Admin ── */}
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/audit" element={<PlaceholderPage title="Journal d'audit" description="Consultez l'historique complet des actions et modifications dans le système." eta="Phase 11" />} />
          <Route path="/rh" element={<PlaceholderPage title="RH" description="Planning des congés, gestion des présences et tableau de bord RH." eta="Phase 10" />} />
          <Route path="/storage" element={<Navigate replace to="/storage/settings" />} />
          <Route path="/storage/settings" element={<StorageSettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate replace to="/dashboard" />} />
    </Routes>
  )
}

export default App
