import { Navigate, Route, Routes } from 'react-router-dom'

import { LoginPage, ProtectedRoute, PublicOnlyRoute } from './auth'
import { AdminPage } from './modules/admin'
import { BanquePage, BanqueSettingsPage, BankPricingPage } from './modules/banque'
import { DashboardPage } from './modules/dashboard'
import { MembersPage } from './modules/members'
import { PlanningPage } from './modules/planning'
import { PricingPage } from './modules/pricing'
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
          <Route path="/club" element={<MembersPage />} />
          <Route path="/planning" element={<PlanningPage />} />
          <Route path="/banque" element={<BanquePage />} />
          <Route path="/banque/settings/:section" element={<BanqueSettingsPage />} />
                    <Route path="/banque/pricing" element={<BankPricingPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/pricing" element={<PricingPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate replace to="/dashboard" />} />
    </Routes>
  )
}

export default App
