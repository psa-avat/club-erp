import { Navigate, Route, Routes } from 'react-router-dom'

import { LoginPage, ProtectedRoute, PublicOnlyRoute } from './auth'
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
} from './modules/banque'
import { DashboardPage } from './modules/dashboard'
import { MembersListPage, MemberFormPage, CommitteesManagementPage, MemberSheetsPage } from './modules/members'
import { MemberPilotSheetPage } from './modules/members'
import { AssetsListPage, AssetDetailPage, AssetFormPage, AssetPricingPage, AssetTypesPage } from './modules/assets'
import { PlanningPage } from './modules/planning'
import { HelloAssoIntegrationPage, HelloAssoPurchasesPage } from './modules/helloasso'
import { PlancheIntegrationPage, PlancheMachinesPushPage, PlancheMembersPushPage } from './modules/planche'
import { StorageSettingsPage } from './modules/storage'
import { AppShell } from './shell/components'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate replace to="/dashboard" />} />

      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/club" element={<Navigate replace to="/club/members/core" />} />
          <Route path="/club/members" element={<Navigate replace to="/club/members/core" />} />
          <Route path="/club/members/:screen" element={<MembersListPage />} />
          <Route path="/club/members/new" element={<MemberFormPage />} />
          <Route path="/club/members/:memberUuid/edit" element={<MemberFormPage />} />
          <Route path="/club/members/:memberUuid/pilot-sheet" element={<MemberPilotSheetPage />} />
          <Route path="/club/commissions" element={<CommitteesManagementPage />} />
          <Route path="/club/sheets" element={<MemberSheetsPage />} />
          <Route path="/planning" element={<PlanningPage />} />
          <Route path="/helloasso" element={<Navigate replace to="/helloasso/integration" />} />
          <Route path="/helloasso/integration" element={<HelloAssoIntegrationPage />} />
          <Route path="/helloasso/purchases" element={<HelloAssoPurchasesPage />} />
          <Route path="/planche" element={<Navigate replace to="/planche/integration" />} />
          <Route path="/planche/integration" element={<PlancheIntegrationPage />} />
          <Route path="/planche/members-push" element={<PlancheMembersPushPage />} />
          <Route path="/planche/machines-push" element={<PlancheMachinesPushPage />} />
          <Route path="/storage" element={<Navigate replace to="/storage/settings" />} />
          <Route path="/storage/settings" element={<StorageSettingsPage />} />
          <Route path="/banque" element={<BanquePage />} />
          <Route path="/banque/dashboard" element={<BanqueDashboardPage />} />
          <Route path="/banque/operations" element={<BanqueDailyOpsPage />} />
          <Route path="/banque/factures-fournisseurs/new" element={<SupplierInvoicePage />} />
          <Route path="/banque/facturation-membres" element={<MemberBulkBillingPage />} />
          <Route path="/banque/accounts" element={<BanqueCoaPage />} />
          <Route path="/banque/journal" element={<BanqueJournalEntriesPage />} />
          <Route path="/banque/journal/entries" element={<BanqueJournalEntriesPage />} />
          <Route path="/banque/journal/entry/new" element={<BanqueJournalEntryWorkspacePage />} />
          <Route path="/banque/journal/entry/:entryUuid" element={<BanqueJournalEntryWorkspacePage />} />
          <Route path="/banque/journal/templates" element={<BanqueJournalTemplatesPage />} />
          <Route path="/banque/settings/:section" element={<BanqueSettingsPage />} />
          <Route path="/banque/pricing" element={<BankPricingPage />} />
          <Route path="/banque/pricing/versions/:fiscalYearUuid/:versionUuid/edit" element={<BankPricingVersionEditPage />} />
          <Route path="/banque/fiscal-years" element={<BanqueFiscalYearsPage />} />
          <Route path="/banque/pcg" element={<BanquePcgPage />} />
          <Route path="/banque/reports" element={<FinancialReportsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/pricing" element={<Navigate replace to="/banque/pricing" />} />
          <Route path="/assets" element={<AssetsListPage />} />
          <Route path="/assets/types" element={<AssetTypesPage />} />
          <Route path="/assets/new" element={<AssetFormPage />} />
          <Route path="/assets/:uuid" element={<AssetDetailPage />} />
          <Route path="/assets/:uuid/edit" element={<AssetFormPage />} />
          <Route path="/assets/:uuid/pricing" element={<AssetPricingPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate replace to="/dashboard" />} />
    </Routes>
  )
}

export default App
